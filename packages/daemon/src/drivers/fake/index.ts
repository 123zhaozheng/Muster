// OWNER: B2. Deterministic scripted driver — makes the whole system demoable without any real agent.
import { randomUUID } from "node:crypto";
import type { DetectedAgent, DiffFile } from "@muster/protocol";
import type { AgentDriver, DriverCaps, DriverEvent, DriverSession, SendMode, StartSessionOpts } from "../../core/contracts";

export interface FakeDriverOptions {
  /** "fast" ≈ 20ms per step (tests). Default: env MUSTER_FAKE_SPEED=fast, otherwise 300~800ms per step. */
  speed?: "fast" | "normal";
  /** Chance (0..1, seeded by prompt) of asking for approval even when the prompt has no install keyword. */
  randomApprovalRate?: number;
}

const INSTALL_RE = /安装|install|依赖/i;

// ───────────────────────── deterministic helpers ─────────────────────────

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

function shorten(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(one);
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : one;
}

// ───────────────────────── script material ─────────────────────────

const FILES = [
  { src: "src/payment/callback.ts", test: "src/payment/callback.test.ts" },
  { src: "src/queue/retry.ts", test: "src/queue/retry.test.ts" },
  { src: "src/api/orders.ts", test: "src/api/orders.test.ts" },
  { src: "src/auth/session.ts", test: "src/auth/session.test.ts" },
] as const;

const CAUSES = [
  "重复请求没有做幂等校验，会被重复处理",
  "失败后没有退避重试，瞬时错误会直接丢单",
  "边界条件没有判空，异常输入会直接抛错",
] as const;

/** Builds a unified diff for one file from `' ctx' / '-del' / '+add'` lines. */
function makeDiffFile(path: string, lines: string[], startLine: number): DiffFile {
  const additions = lines.filter((l) => l.startsWith("+")).length;
  const deletions = lines.filter((l) => l.startsWith("-")).length;
  const oldLen = lines.length - additions;
  const newLen = lines.length - deletions;
  const patch = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${startLine},${oldLen} +${startLine},${newLen} @@`,
    ...lines,
  ].join("\n");
  return { path, additions, deletions, patch };
}

function makeDiff(rng: () => number, file: (typeof FILES)[number]): DiffFile[] {
  const start = 10 + Math.floor(rng() * 80);
  const src = makeDiffFile(
    file.src,
    [
      " export async function handle(input: Input) {",
      "   const state = await load(input.id);",
      "-  await apply(state);",
      "+  if (state.done) return ok(state); // 已处理过则直接返回",
      "+  await apply(state, { key: input.nonce });",
      "   return ok(state);",
      " }",
    ],
    start,
  );
  const files = [src];
  if (rng() < 0.6) {
    files.push(
      makeDiffFile(
        file.test,
        [
          '   it("正常请求返回成功", async () => {',
          "     expect(await handle(input)).toEqual(ok(state));",
          "   });",
          '+  it("重复请求只处理一次", async () => {',
          "+    await handle(input);",
          "+    await handle(input);",
          "+    expect(applied).toHaveLength(1);",
          "+  });",
        ],
        5 + Math.floor(rng() * 20),
      ),
    );
  }
  return files;
}

function verbFor(prompt: string): string {
  if (/重构|refactor/i.test(prompt)) return "重构";
  if (/测试|test/i.test(prompt)) return "补充测试";
  if (/修|fix|bug|错/i.test(prompt)) return "修复";
  return "处理";
}

// ───────────────────────── async event queue ─────────────────────────

class EventQueue implements AsyncIterable<DriverEvent> {
  private items: DriverEvent[] = [];
  private waiter?: (r: IteratorResult<DriverEvent>) => void;
  private ended = false;

  push(ev: DriverEvent): void {
    if (this.ended) return;
    const w = this.waiter;
    if (w) {
      this.waiter = undefined;
      w({ value: ev, done: false });
    } else {
      this.items.push(ev);
    }
  }

  end(): void {
    this.ended = true;
    const w = this.waiter;
    this.waiter = undefined;
    w?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<DriverEvent> {
    return {
      next: () => {
        const v = this.items.shift();
        if (v) return Promise.resolve({ value: v, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => {
          this.waiter = res;
        });
      },
      return: async () => ({ value: undefined, done: true }),
    };
  }
}

// ───────────────────────── session ─────────────────────────

interface Timing {
  stepMin: number;
  stepMax: number;
  chunk: number;
}

/** Per-turn control block: lets interrupt / close cut a sleep or an approval wait short. */
interface TurnCtl {
  aborted: boolean;
  followUp?: string;
  wake?: () => void;
}

interface SessionInit {
  kind: AgentDriver["kind"];
  timing: Timing;
  approvalRate: number;
  nativeId?: string;
  history?: string[];
  forkedAt?: number;
}

const CAPS: DriverCaps = { steer: true, fork: true, interrupt: true, approvals: true };

class FakeSession implements DriverSession {
  readonly nativeId: string;
  readonly caps = CAPS;
  readonly events: AsyncIterable<DriverEvent>;

  private readonly out = new EventQueue();
  private closed = false;
  private running = false;
  private turnNo: number;
  /** Prompt of every turn started so far (index 0 = turn 1). */
  private history: string[];
  private forkedAt?: number;
  private queued: string[] = [];
  private steers: string[] = [];
  private cur?: TurnCtl;
  private approvals = new Map<string, (allow: boolean) => void>();

  constructor(private readonly init: SessionInit) {
    this.nativeId = init.nativeId ?? `fake-${init.kind}-${randomUUID().slice(0, 8)}`;
    this.history = init.history ?? [];
    this.turnNo = this.history.length;
    this.forkedAt = init.forkedAt;
    this.events = this.out;
  }

  /** Begins the first turn (called by the driver; the prompt is the first user message). */
  begin(prompt: string): void {
    if (prompt.trim()) this.startLoop(prompt);
  }

  async send(text: string, mode: SendMode): Promise<void> {
    if (this.closed) throw new Error("fake session is closed");
    if (!this.running) {
      this.startLoop(text);
      return;
    }
    const cur = this.cur;
    switch (mode) {
      case "steer":
        this.steers.push(text);
        break;
      case "interrupt":
        if (cur) {
          if (cur.followUp !== undefined) this.queued.unshift(cur.followUp);
          cur.followUp = text;
          this.abort(cur);
        } else {
          this.queued.push(text);
        }
        break;
      default: // normal | queue
        this.queued.push(text);
    }
  }

  async interrupt(): Promise<void> {
    if (this.cur) this.abort(this.cur);
  }

  async resolveApproval(requestId: string, allow: boolean): Promise<void> {
    this.approvals.get(requestId)?.(allow);
  }

  async fork(atTurn: number): Promise<DriverSession> {
    if (!Number.isInteger(atTurn) || atTurn < 0) throw new RangeError(`invalid atTurn: ${atTurn}`);
    const n = Math.min(atTurn, this.history.length);
    return new FakeSession({ ...this.init, nativeId: undefined, history: this.history.slice(0, n), forkedAt: n });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cur?.wake?.();
    this.out.end();
  }

  // ── turn loop ──

  private startLoop(first: string): void {
    this.running = true;
    void this.loop(first);
  }

  private async loop(first: string): Promise<void> {
    let next: string | undefined = first;
    while (next !== undefined && !this.closed) {
      next = (await this.runTurn(next)) ?? this.queued.shift();
    }
    this.running = false;
  }

  private emit(ev: DriverEvent): void {
    if (!this.closed) this.out.push(ev);
  }

  private abort(ctl: TurnCtl): void {
    ctl.aborted = true;
    ctl.wake?.();
  }

  private stopped(ctl: TurnCtl): boolean {
    return ctl.aborted || this.closed;
  }

  private sleep(ms: number, ctl: TurnCtl): Promise<void> {
    if (this.stopped(ctl)) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        ctl.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      ctl.wake = done;
    });
  }

  /** Waits for resolveApproval; `undefined` means the turn was interrupted / closed meanwhile. */
  private waitApproval(id: string, ctl: TurnCtl): Promise<boolean | undefined> {
    if (this.stopped(ctl)) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.approvals.set(id, (allow) => {
        this.approvals.delete(id);
        ctl.wake = undefined;
        resolve(allow);
      });
      ctl.wake = () => {
        this.approvals.delete(id);
        ctl.wake = undefined;
        resolve(undefined);
      };
    });
  }

  /** Streams one assistant message in small chunks, then text_done. */
  private async say(text: string, ctl: TurnCtl, rng: () => number): Promise<void> {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length && !this.stopped(ctl); ) {
      const size = 3 + Math.floor(rng() * 3);
      this.emit({ t: "text_delta", delta: chars.slice(i, i + size).join("") });
      i += size;
      if (i < chars.length) await this.sleep(this.init.timing.chunk, ctl);
    }
    this.emit({ t: "text_done" });
  }

  /** Runs one turn; returns the follow-up prompt when it was interrupted with one. */
  private async runTurn(prompt: string): Promise<string | undefined> {
    const turn = ++this.turnNo;
    this.history.push(prompt);
    const ctl: TurnCtl = { aborted: false };
    this.cur = ctl;
    const forkNote = this.forkedAt;
    this.forkedAt = undefined;
    const rng = mulberry32(hash(prompt) + Math.imul(turn, 7919));
    const { timing } = this.init;
    const stepDelay = () => timing.stepMin + rng() * (timing.stepMax - timing.stepMin);

    // Everything random is decided up front so the script is a pure function of (prompt, turn).
    const topic = shorten(prompt, 20);
    const verb = verbFor(prompt);
    const file = pick(rng, FILES);
    const cause = pick(rng, CAUSES);
    const needsApproval = INSTALL_RE.test(prompt) || rng() < this.init.approvalRate;
    const diff = makeDiff(rng, file);
    const passed = 6 + Math.floor(rng() * 20);
    const failed = rng() < 0.15 ? 1 : 0;
    const tokens = 3000 + Math.floor(rng() * 9000);
    const approvalId = `${this.nativeId}-ap${turn}`;
    const steered: string[] = [];
    let denied = false;

    this.emit({ t: "turn_start", turn });

    const applySteers = async () => {
      while (this.steers.length && !this.stopped(ctl)) {
        const text = this.steers.shift()!;
        steered.push(text);
        this.emit({ t: "steer_applied", text });
        await this.say(`收到你的补充：「${shorten(text, 30)}」，我会按这个方向调整接下来的步骤。`, ctl, rng);
      }
    };

    const tool = (
      toolName: string,
      kind: "read" | "command" | "edit",
      label: string,
      output: string,
      ok = true,
    ): DriverEvent => ({ t: "tool", tool: toolName, kind, label, ok, output });

    const steps: Array<() => Promise<void>> = [
      async () => {
        const lead =
          forkNote !== undefined
            ? `这是从第 ${forkNote} 步分支出来的新任务，我沿用前 ${forkNote} 轮的上下文，换一种思路继续。`
            : turn > 1
              ? `收到新的要求：「${topic}」。`
              : "";
        await this.say(`${lead}我先读一下与「${topic}」相关的代码，看看现状。`, ctl, rng);
      },
      async () => this.emit(tool("read", "read", file.src, "已读取 118 行")),
      async () => this.emit(tool("read", "read", file.test, "已读取 64 行")),
      async () => this.emit(tool("read", "read", "package.json", "已读取 32 行")),
      async () =>
        this.emit(tool("bash", "command", `pnpm vitest run ${file.test}`, `FAIL 1 · PASS ${passed}`, false)),
    ];

    if (needsApproval) {
      steps.push(async () => {
        this.emit({
          t: "approval",
          requestId: approvalId,
          title: "运行 pnpm install",
          detail: "pnpm install",
          risk: "medium",
        });
        const allow = await this.waitApproval(approvalId, ctl);
        if (allow === undefined) return;
        if (allow) {
          this.emit(tool("bash", "command", "pnpm install", "依赖已是最新"));
        } else {
          denied = true;
          await this.say("好的，不运行 pnpm install，我改用现有依赖和已有脚本继续。", ctl, rng);
        }
      });
    }

    steps.push(
      async () =>
        this.say(
          `读完了。问题出在 ${file.src}：${cause}。${denied ? "不新增依赖，" : ""}我来改一下。`,
          ctl,
          rng,
        ),
      async () => this.emit(tool("edit", "edit", file.src, `+${diff[0]!.additions} -${diff[0]!.deletions}`)),
      async () => this.emit({ t: "diff", files: diff }),
      async () =>
        this.emit(tool("bash", "command", "pnpm test", failed ? `FAIL ${failed} · PASS ${passed}` : `PASS ${passed}`, failed === 0)),
      async () => this.emit({ t: "tests", passed, failed }),
      async () => {
        const parts = [
          `搞定了：${verb}「${topic}」，改动 ${diff.length} 个文件，${passed} 个测试通过${failed ? `、${failed} 个失败` : ""}。`,
        ];
        for (const s of steered) parts.push(`按你的插话「${shorten(s, 30)}」做了调整。`);
        if (denied) parts.push("因为没有运行 pnpm install，没有新增依赖。");
        if (forkNote !== undefined) parts.push(`这是从第 ${forkNote} 步分支后的另一种实现。`);
        if (failed) parts.push("还有测试没过，需要你看一下。");
        await this.say(parts.join(""), ctl, rng);
      },
    );

    let status: "completed" | "interrupted" | "failed" = "completed";
    let error: string | undefined;
    try {
      for (const step of steps) {
        await this.sleep(stepDelay(), ctl);
        if (this.stopped(ctl)) break;
        await applySteers();
        if (this.stopped(ctl)) break;
        await step();
        if (this.stopped(ctl)) break;
      }
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
    }
    if (status === "completed" && ctl.aborted) status = "interrupted";

    // A steer that arrived after the last step boundary must not be lost: run it as its own turn.
    if (this.steers.length) {
      this.queued.unshift(...this.steers);
      this.steers = [];
    }

    this.cur = undefined;
    this.emit({
      t: "turn_end",
      status,
      ...(error ? { error } : {}),
      usage: { tokens, costUsd: Math.round(tokens * 0.000004 * 10000) / 10000 },
    });
    return ctl.followUp;
  }
}

// ───────────────────────── driver ─────────────────────────

export function createFakeDriver(kind: AgentDriver["kind"] = "native", opts: FakeDriverOptions = {}): AgentDriver {
  const fast = (opts.speed ?? (process.env.MUSTER_FAKE_SPEED === "fast" ? "fast" : "normal")) === "fast";
  const timing: Timing = fast ? { stepMin: 20, stepMax: 20, chunk: 2 } : { stepMin: 300, stepMax: 800, chunk: 40 };
  const approvalRate = opts.randomApprovalRate ?? 0.25;

  return {
    kind,
    async detect(): Promise<DetectedAgent> {
      return {
        engine: kind === "codex" || kind === "claude" ? kind : "other",
        command: `fake-${kind}`,
        version: "fake-1.0",
        found: true,
      };
    },
    async start(o: StartSessionOpts): Promise<DriverSession> {
      const session = new FakeSession({ kind, timing, approvalRate, nativeId: o.resumeNativeId });
      session.begin(o.prompt);
      return session;
    },
  };
}
