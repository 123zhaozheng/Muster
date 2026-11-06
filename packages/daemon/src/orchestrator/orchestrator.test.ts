// B5 编排器测试：用 createHub + 测试内的极简假驱动，覆盖任务生命周期。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_THREAD_ID } from "@muster/protocol";
import type { Entry, Task } from "@muster/protocol";
import type {
  AgentDriver, DriverCaps, DriverEvent, DriverRegistry, DriverSession, Hub, Orchestrator, Router, SendMode, StartSessionOpts,
} from "../core/contracts";
import { createHub } from "../core/hub";
import { createOrchestrator } from "./orchestrator";

// ───────────────────────── 假驱动 ─────────────────────────

class FakeSession implements DriverSession {
  nativeId: string;
  caps: DriverCaps = { steer: true, fork: true, interrupt: true, approvals: true };
  sent: { text: string; mode: SendMode }[] = [];
  interrupts = 0;
  resolved: { requestId: string; allow: boolean }[] = [];
  forks: { atTurn: number; cwd?: string; session: FakeSession }[] = [];
  closed = false;
  failSend = false;
  private buf: DriverEvent[] = [];
  private waiter?: () => void;
  private ended = false;

  constructor(nativeId: string, private readonly makeFork: (cwd?: string) => FakeSession) {
    this.nativeId = nativeId;
  }

  emit(...evs: DriverEvent[]): void {
    this.buf.push(...evs);
    this.waiter?.();
  }

  end(): void {
    this.ended = true;
    this.waiter?.();
  }

  events: AsyncIterable<DriverEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<DriverEvent>> => {
        while (this.buf.length === 0) {
          if (this.ended) return { done: true, value: undefined };
          await new Promise<void>((r) => (this.waiter = r));
        }
        return { done: false, value: this.buf.shift()! };
      },
    }),
  };

  async send(text: string, mode: SendMode): Promise<void> {
    if (this.failSend) throw new Error("boom");
    this.sent.push({ text, mode });
  }
  async interrupt(): Promise<void> {
    this.interrupts++;
  }
  async resolveApproval(requestId: string, allow: boolean): Promise<void> {
    this.resolved.push({ requestId, allow });
  }
  async fork(atTurn: number, opts?: { cwd?: string }): Promise<DriverSession> {
    const session = this.makeFork(opts?.cwd);
    this.forks.push({ atTurn, cwd: opts?.cwd, session });
    return session;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.end();
  }
}

class FakeDriver implements AgentDriver {
  kind: AgentDriver["kind"] = "codex";
  sessions: FakeSession[] = [];
  startOpts: StartSessionOpts[] = [];
  failStart?: string;
  caps?: Partial<DriverCaps>;
  private n = 0;

  async detect() {
    return { engine: "codex" as const, command: "codex", found: true };
  }
  private make = (): FakeSession => {
    const s = new FakeSession(`native-${++this.n}`, () => this.make());
    Object.assign(s.caps, this.caps);
    this.sessions.push(s);
    return s;
  };
  async start(opts: StartSessionOpts): Promise<DriverSession> {
    this.startOpts.push(opts);
    if (this.failStart) throw new Error(this.failStart);
    return this.make();
  }
}

// ───────────────────────── 测试脚手架 ─────────────────────────

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const gitSync = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();

function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  gitSync(dir, "init", "-q");
  gitSync(dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

const BOT = "bot-xiaoma";
let tmp: string;
let hub: Hub;
let driver: FakeDriver;
let router: Router & { onTaskEvent: ReturnType<typeof vi.fn> };
let orch: Orchestrator;

function build(h: Hub = hub, extra: { recoverTimeoutMs?: number } = {}): Orchestrator {
  const drivers: DriverRegistry = new Map([["codex", driver]]);
  return createOrchestrator({ hub: h, drivers, dataDir: tmp, getRouter: () => router, ...extra });
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "muster-orch-"));
  hub = createHub({ dataDir: tmp });
  driver = new FakeDriver();
  router = { handleUserMessage: vi.fn(async () => "e"), onTaskEvent: vi.fn(async () => {}) };
  orch = build();
});

afterEach(async () => {
  await orch.shutdown();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const start = (o: { cwd?: string; unattended?: boolean } = {}): Promise<Task> =>
  orch.startTask({ botId: BOT, title: "修支付回调", prompt: "修一下支付回调", parentThreadId: MAIN_THREAD_ID, ...o });

const entriesOf = (t: Task): Entry[] => hub.model.entries[t.threadId] ?? [];
const kinds = (t: Task): string[] => entriesOf(t).map((e) => e.kind);
const taskNow = (t: Task): Task => hub.model.tasks[t.id]!;
const session = (i = 0): FakeSession => driver.sessions[i]!;

/** 跑完一整个 turn：返回任务。 */
async function runTurn(t: Task, turn: number, text: string, s = session()): Promise<void> {
  s.emit({ t: "turn_start", turn }, { t: "text_delta", delta: text }, { t: "text_done" }, { t: "turn_end", status: "completed" });
  await settle();
}

// ───────────────────────── startTask ─────────────────────────

describe("startTask", () => {
  it("创建线程/任务/用户消息，更新 bot，并在事件中心留痕", async () => {
    const t = await start();
    expect(t.status).toBe("running");
    expect(hub.model.threads[t.threadId]).toMatchObject({ botId: BOT, taskId: t.id, title: "修支付回调" });
    expect(hub.model.bots[BOT]).toMatchObject({ status: "working", statusDetail: "修支付回调", threadId: t.threadId });
    expect(entriesOf(t)[0]).toMatchObject({ kind: "user", text: "修一下支付回调" });
    expect(hub.model.events[0]).toMatchObject({ source: "callback", title: "回调 · 小码 开始了 修支付回调", taskId: t.id, status: "dispatched" });
    expect(t.parentThreadId).toBe(MAIN_THREAD_ID);
  });

  it("未提供 cwd 时在 dataDir/workspaces/<taskId> 建空目录", async () => {
    const t = await start();
    expect(t.cwd).toBe(path.join(tmp, "workspaces", t.id));
    expect(existsSync(t.cwd!)).toBe(true);
    expect(driver.startOpts[0]).toMatchObject({ cwd: t.cwd, prompt: "修一下支付回调" });
    expect(t.branch).toBeUndefined();
  });

  it("cwd 是 git 仓库时创建 worktree 与 muster/ 分支", async () => {
    const repo = makeRepo(path.join(tmp, "repo"));
    const t = await start({ cwd: repo });
    expect(t.cwd).toBe(path.join(tmp, "worktrees", t.id));
    expect(t.branch).toMatch(/^muster\//);
    expect(existsSync(path.join(t.cwd!, ".git"))).toBe(true);
    expect(gitSync(repo, "branch", "--list", t.branch!)).toContain(t.branch);
    expect(driver.startOpts[0]!.cwd).toBe(t.cwd);
  });

  it("cwd 是仓库子目录时，任务目录对应 worktree 内的同名子目录", async () => {
    const repo = makeRepo(path.join(tmp, "repo"));
    mkdirSync(path.join(repo, "pkg"));
    // 空目录不入库；放一个文件让子目录存在于 HEAD
    execFileSync("node", ["-e", "require('fs').writeFileSync('pkg/a.txt','x')"], { cwd: repo });
    gitSync(repo, "add", ".");
    gitSync(repo, "commit", "-q", "-m", "pkg");
    const t = await start({ cwd: path.join(repo, "pkg") });
    expect(t.cwd).toBe(path.join(tmp, "worktrees", t.id, "pkg"));
    expect(existsSync(path.join(t.cwd!, "a.txt"))).toBe(true);
  });

  it("cwd 不是 git 仓库时直接使用原目录", async () => {
    const dir = path.join(tmp, "plain");
    mkdirSync(dir);
    const t = await start({ cwd: dir });
    expect(t.cwd).toBe(dir);
    expect(t.branch).toBeUndefined();
  });

  it("worktree 创建失败（空仓库）时回退到原目录并记 system entry", async () => {
    const dir = path.join(tmp, "empty-repo");
    mkdirSync(dir);
    gitSync(dir, "init", "-q");
    const t = await start({ cwd: dir });
    expect(t.cwd).toBe(dir);
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("无法创建 git 工作树"))).toBe(true);
  });

  it("驱动启动失败：抛错，不留下任务", async () => {
    driver.failStart = "no codex";
    await expect(start()).rejects.toMatchObject({ code: "internal" });
    expect(Object.keys(hub.model.tasks)).toHaveLength(0);
  });

  it("主 Bot / 未知 Bot / 无驱动 都被拒绝", async () => {
    await expect(orch.startTask({ botId: "bot-pip", title: "x", prompt: "x", parentThreadId: MAIN_THREAD_ID })).rejects.toMatchObject({ code: "bad_request" });
    await expect(orch.startTask({ botId: "nope", title: "x", prompt: "x", parentThreadId: MAIN_THREAD_ID })).rejects.toMatchObject({ code: "not_found" });
    await expect(orch.startTask({ botId: "bot-ake", title: "x", prompt: "x", parentThreadId: MAIN_THREAD_ID })).rejects.toMatchObject({ code: "unsupported" });
  });
});

// ───────────────────────── 事件翻译 ─────────────────────────

describe("事件翻译", () => {
  it("文本：首个 delta 建 streaming bot entry，后续 delta 追加，text_done 结束流式", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "text_delta", delta: "你好" }, { t: "text_delta", delta: "，世界" });
    await settle();
    let bot = entriesOf(t).find((e) => e.kind === "bot");
    expect(bot).toMatchObject({ text: "你好，世界", streaming: true });
    session().emit({ t: "text_done" });
    await settle();
    bot = entriesOf(t).find((e) => e.kind === "bot");
    expect(bot).toMatchObject({ text: "你好，世界", streaming: false });
    expect(hub.model.threads[t.threadId]!.lastText).toBe("你好，世界");
  });

  it("思考：thinking_delta 建 streaming thinking entry，正文开始时收起并记下用时；不改线程预览", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "thinking_delta", delta: "先看" }, { t: "thinking_delta", delta: "代码" });
    await settle();
    expect(entriesOf(t).find((e) => e.kind === "thinking")).toMatchObject({ botId: BOT, text: "先看代码", streaming: true });
    session().emit({ t: "text_delta", delta: "好的" }, { t: "text_done" }, { t: "thinking_delta", delta: "再想想" }, { t: "thinking_done" });
    await settle();
    expect(kinds(t)).toEqual(["user", "thinking", "bot", "thinking"]);
    const [first, second] = entriesOf(t).filter((e) => e.kind === "thinking") as Extract<Entry, { kind: "thinking" }>[];
    expect(first).toMatchObject({ text: "先看代码", streaming: false });
    expect(first!.durationMs).toBeGreaterThanOrEqual(0);
    expect(second).toMatchObject({ text: "再想想", streaming: false });
    expect(hub.model.threads[t.threadId]!.lastText).toBe("好的");
  });

  it("连续 tool 事件聚合成一个 tool_summary 并持续更新计数", async () => {
    const t = await start();
    session().emit(
      { t: "turn_start", turn: 1 },
      { t: "tool", tool: "read", kind: "read", label: "a.ts" },
      { t: "tool", tool: "read", kind: "read", label: "b.ts" },
      { t: "tool", tool: "bash", kind: "command", label: "pnpm test", ok: true, output: "ok" },
      { t: "tool", tool: "edit", kind: "edit", label: "a.ts" },
      { t: "tool", tool: "x", kind: "other", label: "misc" },
    );
    await settle();
    const sums = entriesOf(t).filter((e) => e.kind === "tool_summary");
    expect(sums).toHaveLength(1);
    expect(sums[0]).toMatchObject({ reads: 2, commands: 1, edits: 1 });
    expect((sums[0] as Extract<Entry, { kind: "tool_summary" }>).items.map((i) => i.label)).toEqual(["a.ts", "b.ts", "pnpm test", "a.ts", "misc"]);
  });

  it("文本打断工具聚合：之后的 tool 开新的 summary；顺序正确", async () => {
    const t = await start();
    session().emit(
      { t: "turn_start", turn: 1 },
      { t: "tool", tool: "read", kind: "read", label: "a" },
      { t: "text_delta", delta: "看完了" },
      { t: "text_done" },
      { t: "tool", tool: "read", kind: "read", label: "b" },
    );
    await settle();
    expect(kinds(t)).toEqual(["user", "tool_summary", "bot", "tool_summary"]);
  });

  it("diff / tests 翻译成对应 entry", async () => {
    const t = await start();
    session().emit(
      { t: "turn_start", turn: 1 },
      { t: "diff", files: [{ path: "a.ts", additions: 3, deletions: 1, patch: "@@" }] },
      { t: "tests", passed: 12, failed: 1 },
    );
    await settle();
    expect(entriesOf(t).find((e) => e.kind === "diff")).toMatchObject({ botId: BOT, files: [{ path: "a.ts" }] });
    expect(entriesOf(t).find((e) => e.kind === "test_result")).toMatchObject({ passed: 12, failed: 1 });
  });

  it("turn_end completed：任务 done、100%、累计 tokens/cost，bot done，router 通知，事件中心留痕", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "text_delta", delta: "好了" }, { t: "turn_end", status: "completed", usage: { tokens: 1200, costUsd: 0.05 } });
    await settle();
    const now = taskNow(t);
    expect(now).toMatchObject({ status: "done", progress: 100, tokens: 1200, costUsd: 0.05 });
    expect(now.finishedAt).toBeDefined();
    expect(hub.model.bots[BOT]).toMatchObject({ status: "done", costWeekUsd: 0.05 });
    expect(hub.model.entries[t.threadId]!.find((e) => e.kind === "bot")).toMatchObject({ streaming: false });
    expect(router.onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ id: t.id, status: "done" }), "done");
    expect(hub.model.events[0]!.title).toBe("回调 · 小码 完成了 修支付回调");
  });

  it("再次发消息后任务恢复 running，第二个 turn 的用量累加", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "completed", usage: { tokens: 100 } });
    await settle();
    expect(taskNow(t).status).toBe("done");
    await orch.sendToThread(t.threadId, "再改一点", "normal");
    session().emit({ t: "turn_start", turn: 2 });
    await settle();
    expect(taskNow(t)).toMatchObject({ status: "running" });
    expect(taskNow(t).finishedAt).toBeUndefined();
    expect(hub.model.bots[BOT]!.status).toBe("working");
    session().emit({ t: "turn_end", status: "completed", usage: { tokens: 50 } });
    await settle();
    expect(taskNow(t)).toMatchObject({ status: "done", tokens: 150 });
  });

  it("turn_end failed：任务 failed，bot error，system entry，router failed", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "failed", error: "模型额度不足" });
    await settle();
    expect(taskNow(t).status).toBe("failed");
    expect(hub.model.bots[BOT]!.status).toBe("error");
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("模型额度不足"))).toBe(true);
    expect(router.onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ id: t.id }), "failed");
    expect(hub.model.events[0]).toMatchObject({ status: "failed" });
  });

  it("会话事件流意外结束：任务标为 failed", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    session().end();
    await settle();
    expect(taskNow(t).status).toBe("failed");
    expect(router.onTaskEvent).toHaveBeenCalledWith(expect.anything(), "failed");
  });

  it("单个事件处理异常不会拖垮后续事件", async () => {
    const t = await start();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 缺少 diff.files 会让处理抛错
    session().emit({ t: "turn_start", turn: 1 }, { t: "diff" } as unknown as DriverEvent, { t: "text_delta", delta: "仍在继续" });
    await settle();
    spy.mockRestore();
    expect(entriesOf(t).some((e) => e.kind === "bot" && e.text === "仍在继续")).toBe(true);
  });
});

// ───────────────────────── sendToThread ─────────────────────────

describe("sendToThread", () => {
  it("normal：空闲时写 user entry 并以 normal 发送", async () => {
    const t = await start();
    await runTurn(t, 1, "ok");
    const id = await orch.sendToThread(t.threadId, "继续", "normal");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ kind: "user", text: "继续" });
    expect(session().sent).toEqual([{ text: "继续", mode: "normal" }]);
  });

  it("steer：忙碌时写 steer entry（next_step），steer_applied 后变 applied", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    const id = await orch.sendToThread(t.threadId, "别动数据库", "steer");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ kind: "steer", mode: "steer", applied: "next_step" });
    expect(session().sent).toEqual([{ text: "别动数据库", mode: "steer" }]);
    session().emit({ t: "steer_applied", text: "别动数据库" });
    await settle();
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ applied: "applied" });
  });

  it("steer 降级：caps.steer=false 时按 queue 发送，entry 体现为 queue 并有提示", async () => {
    const t = await start();
    session().caps.steer = false;
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    const id = await orch.sendToThread(t.threadId, "顺便加个日志", "steer");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ kind: "steer", mode: "queue", applied: "pending" });
    expect(session().sent).toEqual([{ text: "顺便加个日志", mode: "queue" }]);
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("不支持插话"))).toBe(true);
  });

  it("queue：当前 turn 结束后任务保持 running，下一个 turn 开始时 entry 变 applied，全部完成后才 done", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    const id = await orch.sendToThread(t.threadId, "之后再补测试", "queue");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ mode: "queue", applied: "pending" });
    session().emit({ t: "turn_end", status: "completed" });
    await settle();
    expect(taskNow(t).status).toBe("running");
    expect(hub.model.bots[BOT]!.status).toBe("working");
    expect(router.onTaskEvent).not.toHaveBeenCalled();
    session().emit({ t: "turn_start", turn: 2 });
    await settle();
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ applied: "applied" });
    session().emit({ t: "turn_end", status: "completed" });
    await settle();
    expect(taskNow(t).status).toBe("done");
    expect(router.onTaskEvent).toHaveBeenCalledTimes(1);
  });

  it("interrupt：忙碌时写 interrupt entry 并以 interrupt 发送；被打断的 turn 不会让任务 done", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    const id = await orch.sendToThread(t.threadId, "换个思路", "interrupt");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ kind: "steer", mode: "interrupt", applied: "pending" });
    expect(session().sent).toEqual([{ text: "换个思路", mode: "interrupt" }]);
    session().emit({ t: "turn_end", status: "interrupted" }, { t: "turn_start", turn: 2 });
    await settle();
    expect(taskNow(t).status).toBe("running");
    expect(entriesOf(t).find((e) => e.id === id)).toMatchObject({ applied: "applied" });
    expect(router.onTaskEvent).not.toHaveBeenCalled();
  });

  it("空闲时 steer 退化为普通发送", async () => {
    const t = await start();
    await runTurn(t, 1, "ok");
    const id = await orch.sendToThread(t.threadId, "再来", "steer");
    expect(entriesOf(t).find((e) => e.id === id)?.kind).toBe("user");
    expect(session().sent[0]).toEqual({ text: "再来", mode: "normal" });
  });

  it("发送失败：抛错并回滚 busy 状态", async () => {
    const t = await start();
    await runTurn(t, 1, "ok");
    session().failSend = true;
    await expect(orch.sendToThread(t.threadId, "x", "normal")).rejects.toMatchObject({ code: "internal" });
    session().failSend = false;
    session().emit({ t: "turn_start", turn: 2 }, { t: "turn_end", status: "completed" });
    await settle();
    expect(taskNow(t).status).toBe("done");
  });

  it("未知线程 / 已取消任务 被拒绝", async () => {
    await expect(orch.sendToThread("thread-nope", "x", "normal")).rejects.toMatchObject({ code: "not_found" });
    const t = await start();
    await orch.handlers["task.cancel"]!({ taskId: t.id });
    await expect(orch.sendToThread(t.threadId, "x", "normal")).rejects.toMatchObject({ code: "conflict" });
  });
});

// ───────────────────────── 审批 ─────────────────────────

describe("审批", () => {
  const ask = (s: FakeSession) =>
    s.emit({ t: "turn_start", turn: 1 }, { t: "approval", requestId: "req-1", title: "运行 pnpm install", detail: "pnpm install", risk: "medium" });

  it("approval 事件：创建 pending 审批 + approval entry，任务/bot 进入 waiting_approval，router 被通知", async () => {
    const t = await start();
    ask(session());
    await settle();
    const ap = Object.values(hub.model.approvals)[0]!;
    expect(ap).toMatchObject({ title: "小码 想运行 pnpm install", detail: "pnpm install", risk: "medium", status: "pending", taskId: t.id, botId: BOT });
    expect(ap.unattended).toBeUndefined();
    expect(entriesOf(t).find((e) => e.kind === "approval")).toMatchObject({ approvalId: ap.id });
    expect(taskNow(t).status).toBe("waiting_approval");
    expect(hub.model.bots[BOT]!.status).toBe("waiting_approval");
    expect(router.onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ id: t.id, status: "waiting_approval" }), "waiting_approval");
  });

  it("标题由结构化数据拼成：去掉多余前缀/换行并限长", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "approval", requestId: "r", title: `小码 想运行\n  rm -rf /${"x".repeat(200)}`, risk: "high" });
    await settle();
    const ap = Object.values(hub.model.approvals)[0]!;
    expect(ap.title.startsWith("小码 想运行 rm -rf /")).toBe(true);
    expect(ap.title).not.toContain("\n");
    expect(ap.title.length).toBeLessThanOrEqual(90);
    expect(t.id).toBeTruthy();
  });

  it("允许：回复引擎 allow=true，审批 allowed，任务恢复 running", async () => {
    const t = await start();
    ask(session());
    await settle();
    const ap = Object.values(hub.model.approvals)[0]!;
    const res = await orch.handlers["approval.resolve"]!({ approvalId: ap.id, decision: "allow" });
    expect(res.approval).toMatchObject({ status: "allowed" });
    expect(res.approval.resolvedAt).toBeDefined();
    expect(session().resolved).toEqual([{ requestId: "req-1", allow: true }]);
    expect(hub.model.approvals[ap.id]!.status).toBe("allowed");
    expect(taskNow(t).status).toBe("running");
    expect(hub.model.bots[BOT]!.status).toBe("working");
  });

  it("拒绝：回复引擎 allow=false，审批 denied", async () => {
    const t = await start();
    ask(session());
    await settle();
    const ap = Object.values(hub.model.approvals)[0]!;
    const res = await orch.handlers["approval.resolve"]!({ approvalId: ap.id, decision: "deny" });
    expect(res.approval.status).toBe("denied");
    expect(session().resolved).toEqual([{ requestId: "req-1", allow: false }]);
    expect(taskNow(t).status).toBe("running");
  });

  it("重复处理 / 不存在的审批报错；多个审批全部处理完才恢复 running", async () => {
    const t = await start();
    session().emit(
      { t: "turn_start", turn: 1 },
      { t: "approval", requestId: "r1", title: "运行 a", risk: "low" },
      { t: "approval", requestId: "r2", title: "运行 b", risk: "low" },
    );
    await settle();
    const [a, b] = Object.values(hub.model.approvals);
    await orch.handlers["approval.resolve"]!({ approvalId: a!.id, decision: "allow" });
    expect(taskNow(t).status).toBe("waiting_approval");
    await expect(orch.handlers["approval.resolve"]!({ approvalId: a!.id, decision: "allow" })).rejects.toMatchObject({ code: "conflict" });
    await orch.handlers["approval.resolve"]!({ approvalId: b!.id, decision: "deny" });
    expect(taskNow(t).status).toBe("running");
    await expect(orch.handlers["approval.resolve"]!({ approvalId: "nope", decision: "allow" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("无人值守：立即自动拒绝，记 system entry，任务保持 running，不通知 router", async () => {
    const t = await start({ unattended: true });
    ask(session());
    await settle();
    const ap = Object.values(hub.model.approvals)[0]!;
    expect(ap).toMatchObject({ status: "denied", unattended: true });
    expect(session().resolved).toEqual([{ requestId: "req-1", allow: false }]);
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("自动拒绝"))).toBe(true);
    expect(taskNow(t).status).toBe("running");
    expect(router.onTaskEvent).not.toHaveBeenCalled();
    expect(hub.model.events[0]!.title).toContain("自动拒绝");
  });

  it("turn 结束时仍未处理的审批会失效（expired）", async () => {
    const t = await start();
    ask(session());
    await settle();
    session().emit({ t: "turn_end", status: "interrupted" });
    await settle();
    expect(Object.values(hub.model.approvals)[0]!.status).toBe("expired");
    expect(taskNow(t).status).toBe("running");
  });
});

// ───────────────────────── interrupt / cancel ─────────────────────────

describe("task.interrupt / task.cancel", () => {
  it("interrupt 调用会话 interrupt；turn_end interrupted 后任务仍 running、bot idle", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    await orch.handlers["task.interrupt"]!({ taskId: t.id });
    expect(session().interrupts).toBe(1);
    session().emit({ t: "turn_end", status: "interrupted" });
    await settle();
    expect(taskNow(t).status).toBe("running");
    expect(hub.model.bots[BOT]).toMatchObject({ status: "idle", statusDetail: "已中断" });
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("打断"))).toBe(true);
  });

  it("cancel：interrupt + close，状态 cancelled，之后到达的事件被忽略", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    await orch.handlers["task.cancel"]!({ taskId: t.id });
    expect(session().interrupts).toBe(1);
    expect(session().closed).toBe(true);
    await settle();
    expect(taskNow(t).status).toBe("cancelled");
    expect(taskNow(t).finishedAt).toBeDefined();
    expect(hub.model.bots[BOT]!.status).toBe("idle");
    expect(router.onTaskEvent).not.toHaveBeenCalled();
    await expect(orch.handlers["task.cancel"]!({ taskId: t.id })).resolves.toEqual({ ok: true });
  });

  it("cancel 会使待审批失效；已结束任务不能取消", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "approval", requestId: "r", title: "运行 x", risk: "low" });
    await settle();
    await orch.handlers["task.cancel"]!({ taskId: t.id });
    expect(Object.values(hub.model.approvals)[0]!.status).toBe("expired");

    const t2 = await start();
    await runTurn(t2, 1, "ok", session(1));
    await expect(orch.handlers["task.cancel"]!({ taskId: t2.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("未知任务：not_found", async () => {
    await expect(orch.handlers["task.interrupt"]!({ taskId: "nope" })).rejects.toMatchObject({ code: "not_found" });
    await expect(orch.handlers["task.cancel"]!({ taskId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });
});

// ───────────────────────── fork / 分支 / adopt ─────────────────────────

describe("fork 与分支", () => {
  /** 跑完 turn1（含 tool/diff/tests），返回 turn1 中 bot 文本 entry id。 */
  async function twoTurns(t: Task): Promise<string> {
    session().emit(
      { t: "turn_start", turn: 1 },
      { t: "text_delta", delta: "方案一" },
      { t: "text_done" },
      { t: "diff", files: [{ path: "a.ts", additions: 1, deletions: 0, patch: "" }] },
      { t: "tests", passed: 3, failed: 0 },
      { t: "turn_end", status: "completed", usage: { tokens: 500 } },
    );
    await settle();
    const botEntry = entriesOf(t).find((e) => e.kind === "bot")!;
    await orch.sendToThread(t.threadId, "第二步", "normal");
    session().emit({ t: "turn_start", turn: 2 }, { t: "text_delta", delta: "方案二" }, { t: "text_done" }, { t: "turn_end", status: "completed" });
    await settle();
    return botEntry.id;
  }

  it("fork：新任务/线程/分支，复制历史（新 id），调用 session.fork(turn)，补“原始路线”", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    const { task, branch } = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });

    expect(session().forks).toHaveLength(1);
    expect(session().forks[0]!.atTurn).toBe(1);
    expect(task).toMatchObject({ forkedFrom: { taskId: t.id, entryId }, botId: BOT, status: "running", parentThreadId: MAIN_THREAD_ID });
    expect(task.threadId).not.toBe(t.threadId);
    expect(hub.model.threads[task.threadId]).toMatchObject({ taskId: task.id });

    // 历史只含 turn1 及之前：user + bot + diff + test_result，外加一条 system；id 全部重新生成
    const copied = hub.model.entries[task.threadId]!;
    expect(copied.map((e) => e.kind)).toEqual(["user", "bot", "diff", "test_result", "system"]);
    expect(copied.every((e) => e.threadId === task.threadId)).toBe(true);
    const oldIds = new Set(entriesOf(t).map((e) => e.id));
    expect(copied.some((e) => oldIds.has(e.id))).toBe(false);
    expect(copied.find((e) => e.kind === "bot")).toMatchObject({ text: "方案一", streaming: false });

    expect(branch).toMatchObject({ taskId: task.id, forkEntryId: entryId, label: "分支 A", botId: BOT });
    const branches = Object.values(hub.model.branches);
    expect(branches.map((b) => b.label)).toEqual(["原始路线", "分支 A"]);
    expect(branches[0]).toMatchObject({ taskId: t.id, forkEntryId: entryId, filesChanged: 1, tests: { passed: 3, failed: 0 }, tokens: 500 });
    expect(hub.model.events[0]!.title).toContain("分支");
  });

  it("多次 fork：标签按 A/B/C 递增，原始路线只建一次；自定义标签原样使用", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    const a = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    const b = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    const c = await orch.handlers["task.fork"]!({ taskId: t.id, entryId, label: "分支 X：队列重试" });
    expect([a.branch.label, b.branch.label, c.branch.label]).toEqual(["分支 A", "分支 B", "分支 X：队列重试"]);
    expect(Object.values(hub.model.branches).filter((x) => x.label === "原始路线")).toHaveLength(1);
  });

  it("fork 的 fork：同源分支共享族谱，task.branches 返回同一根任务派生的全部分支", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    const a = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    // 在分支任务上再分支：需要它有已结束的 turn
    const s2 = session(1);
    expect(a.task.id).not.toBe(t.id);
    s2.emit({ t: "turn_start", turn: 2 }, { t: "text_delta", delta: "分支里的新内容" }, { t: "text_done" }, { t: "turn_end", status: "completed" });
    await settle();
    const forkedBot = entriesOf(a.task).find((e) => e.kind === "bot" && e.text === "分支里的新内容")!;
    const b = await orch.handlers["task.fork"]!({ taskId: a.task.id, entryId: forkedBot.id });
    expect(b.branch.label).toBe("分支 B");
    expect(s2.forks[0]!.atTurn).toBe(2);

    const viaRoot = await orch.handlers["task.branches"]!({ taskId: t.id });
    const viaLeaf = await orch.handlers["task.branches"]!({ taskId: b.task.id });
    expect(viaRoot.branches.map((x) => x.label)).toEqual(["原始路线", "分支 A", "分支 B"]);
    expect(viaLeaf.branches.map((x) => x.id)).toEqual(viaRoot.branches.map((x) => x.id));

    // 无关任务不在同一族
    const other = await start();
    expect((await orch.handlers["task.branches"]!({ taskId: other.id })).branches).toEqual([]);
  });

  it("分支页统计：分支任务的 diff/tests/用量同步到其 Branch", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    const { task, branch } = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    session(1).emit(
      { t: "turn_start", turn: 2 },
      { t: "text_delta", delta: "队列重试已实现" },
      { t: "text_done" },
      { t: "diff", files: [{ path: "q.ts", additions: 5, deletions: 0, patch: "" }, { path: "r.ts", additions: 1, deletions: 0, patch: "" }] },
      { t: "tests", passed: 8, failed: 2 },
      { t: "turn_end", status: "completed", usage: { tokens: 900 } },
    );
    await settle();
    expect(hub.model.branches[branch.id]).toMatchObject({ filesChanged: 2, tests: { passed: 8, failed: 2 }, tokens: 900, summary: "队列重试已实现" });
    expect(taskNow(task).status).toBe("done");
  });

  it("fork 到真实 git 仓库：新 worktree 基于原 worktree 当前 HEAD 新建分支", async () => {
    const repo = makeRepo(path.join(tmp, "repo"));
    const t = await start({ cwd: repo });
    const entryId = await twoTurns(t);
    // 在原 worktree 里提交一次：新分支应基于它当前的 HEAD
    execFileSync("node", ["-e", "require('fs').writeFileSync('new.txt','hi')"], { cwd: t.cwd });
    gitSync(t.cwd!, "add", ".");
    gitSync(t.cwd!, "commit", "-q", "-m", "work");
    const { task } = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    expect(task.cwd).toBe(path.join(tmp, "worktrees", task.id));
    expect(task.branch).toMatch(/^muster\//);
    expect(task.branch).not.toBe(t.branch);
    expect(existsSync(path.join(task.cwd!, "new.txt"))).toBe(true);
    expect(session().forks[0]!.cwd).toBe(task.cwd);
  });

  it("非 git 临时工作区：fork 复制目录内容", async () => {
    const t = await start();
    execFileSync("node", ["-e", "require('fs').writeFileSync('note.txt','abc')"], { cwd: t.cwd });
    const entryId = await twoTurns(t);
    const { task } = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    expect(task.cwd).toBe(path.join(tmp, "workspaces", task.id));
    expect(readFileSync(path.join(task.cwd!, "note.txt"), "utf8")).toBe("abc");
  });

  it("非法 fork：未知 entry / 轮次未结束 / 引擎不支持 / 换成不同引擎的 bot", async () => {
    const t = await start();
    await expect(orch.handlers["task.fork"]!({ taskId: t.id, entryId: "nope" })).rejects.toMatchObject({ code: "not_found" });
    // 轮次进行中
    session().emit({ t: "turn_start", turn: 1 }, { t: "text_delta", delta: "进行中" });
    await settle();
    const live = entriesOf(t).find((e) => e.kind === "bot")!;
    await expect(orch.handlers["task.fork"]!({ taskId: t.id, entryId: live.id })).rejects.toMatchObject({ code: "conflict" });
    session().emit({ t: "text_done" }, { t: "turn_end", status: "completed" });
    await settle();
    await expect(orch.handlers["task.fork"]!({ taskId: t.id, entryId: live.id, botId: "bot-ake" })).rejects.toMatchObject({ code: "unsupported" });
    session().caps.fork = false;
    await expect(orch.handlers["task.fork"]!({ taskId: t.id, entryId: live.id })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("session.fork 失败：抛错且不产生任务/分支", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    session().fork = async () => {
      throw new Error("fork 不可用");
    };
    const before = Object.keys(hub.model.tasks).length;
    await expect(orch.handlers["task.fork"]!({ taskId: t.id, entryId })).rejects.toMatchObject({ code: "internal" });
    expect(Object.keys(hub.model.tasks)).toHaveLength(before);
    expect(Object.keys(hub.model.branches)).toHaveLength(0);
  });

  it("adopt：标记 adopted，同源其余分支 adopted=false；再采纳另一个会切换", async () => {
    const t = await start();
    const entryId = await twoTurns(t);
    const a = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    const b = await orch.handlers["task.fork"]!({ taskId: t.id, entryId });
    const root = Object.values(hub.model.branches).find((x) => x.label === "原始路线")!;

    const res = await orch.handlers["branch.adopt"]!({ branchId: a.branch.id });
    expect(res.branch).toMatchObject({ id: a.branch.id, adopted: true });
    expect(hub.model.branches[a.branch.id]!.adopted).toBe(true);
    expect(hub.model.branches[b.branch.id]!.adopted).toBe(false);
    expect(hub.model.branches[root.id]!.adopted).toBe(false);

    await orch.handlers["branch.adopt"]!({ branchId: b.branch.id });
    expect(hub.model.branches[a.branch.id]!.adopted).toBe(false);
    expect(hub.model.branches[b.branch.id]!.adopted).toBe(true);
    await expect(orch.handlers["branch.adopt"]!({ branchId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });
});

// ───────────────────────── phase 2：bot 快照 / 进度 / 成本 ─────────────────────────

describe("phase 2：bot 传给驱动", () => {
  it("startTask 把当前 bot 快照传给 driver.start；编辑后下一次任务拿到新快照", async () => {
    await start();
    expect(driver.startOpts[0]!.bot).toMatchObject({ id: BOT, name: "小码", kind: "codex" });
    hub.commit({ kind: "bot.updated", bot: { ...hub.model.bots[BOT]!, persona: "新人设", model: { provider: "p", modelId: "m" } } });
    await start();
    expect(driver.startOpts[1]!.bot).toMatchObject({ id: BOT, persona: "新人设", model: { provider: "p", modelId: "m" } });
  });

  it("恢复路径也传 bot", async () => {
    const t = await start();
    await orch.shutdown();
    hub.commit({ kind: "bot.updated", bot: { ...hub.model.bots[BOT]!, persona: "重启后的人设" } });
    orch = build();
    await orch.recover();
    expect(driver.startOpts[1]).toMatchObject({ resumeNativeId: "native-1", bot: { id: BOT, persona: "重启后的人设" } });
    expect(taskNow(t).status).toBe("running");
  });

  it("启动期间 bot 被编辑：任务开始不会覆盖编辑", async () => {
    const orig = driver.start.bind(driver);
    driver.start = async (o) => {
      hub.commit({ kind: "bot.updated", bot: { ...hub.model.bots[BOT]!, tagline: "并发编辑" } });
      return orig(o);
    };
    await start();
    expect(hub.model.bots[BOT]).toMatchObject({ tagline: "并发编辑", status: "working" });
  });
});

describe("phase 2：运行中进度", () => {
  const progressOf = (t: Task): (number | undefined)[] => {
    const seen: (number | undefined)[] = [];
    hub.subscribe((p) => {
      if (p.push.kind === "task.updated" && p.push.task.id === t.id) seen.push(p.push.task.progress);
    });
    return seen;
  };

  it("turn_start 10%，tool/diff/tests 事件递增且不超过 90，turn_end 才到 100；全程单调", async () => {
    const t = await start();
    const seen = progressOf(t);
    session().emit({ t: "turn_start", turn: 1 });
    await settle();
    expect(taskNow(t).progress).toBe(10);
    session().emit({ t: "tool", tool: "read", kind: "read", label: "a" });
    await settle();
    expect(taskNow(t).progress).toBeGreaterThan(10);
    const afterTool = taskNow(t).progress!;
    session().emit({ t: "diff", files: [{ path: "a.ts", additions: 1, deletions: 0, patch: "" }] }, { t: "tests", passed: 1, failed: 0 });
    await settle();
    expect(taskNow(t).progress!).toBeGreaterThan(afterTool);
    for (let i = 0; i < 60; i++) session().emit({ t: "tool", tool: "read", kind: "read", label: `f${i}` });
    await settle();
    expect(taskNow(t).progress!).toBeLessThanOrEqual(90);
    expect(taskNow(t).progress!).toBeGreaterThanOrEqual(80);
    expect(taskNow(t).status).toBe("running");

    session().emit({ t: "turn_end", status: "completed" });
    await settle();
    expect(taskNow(t).progress).toBe(100);
    const nums = seen.filter((x): x is number => x !== undefined);
    expect(nums.at(-1)).toBe(100);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(nums.filter((n) => n < 100).every((n) => n >= 10 && n <= 90)).toBe(true);
  });

  it("节流：连续大量事件的提交次数远少于事件数", async () => {
    const t = await start();
    const seen = progressOf(t);
    session().emit({ t: "turn_start", turn: 1 });
    for (let i = 0; i < 100; i++) session().emit({ t: "tool", tool: "read", kind: "read", label: `f${i}` });
    await settle();
    const progressCommits = seen.filter((x) => x !== undefined);
    expect(progressCommits.length).toBeLessThan(25);
    expect(new Set(progressCommits).size).toBe(progressCommits.length); // 不重复提交相同值
  });

  it("等待审批期间进度保持不动，批准后继续", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "tool", tool: "read", kind: "read", label: "a" }, { t: "approval", requestId: "r", title: "运行 x", risk: "low" });
    await settle();
    const held = taskNow(t).progress!;
    expect(taskNow(t).status).toBe("waiting_approval");
    session().emit({ t: "tool", tool: "read", kind: "read", label: "b" });
    await settle();
    expect(taskNow(t).progress).toBe(held);
    const ap = Object.values(hub.model.approvals)[0]!;
    await orch.handlers["approval.resolve"]!({ approvalId: ap.id, decision: "allow" });
    expect(taskNow(t).progress).toBe(held);
    session().emit({ t: "diff", files: [{ path: "a.ts", additions: 1, deletions: 0, patch: "" }] });
    await settle();
    expect(taskNow(t).progress!).toBeGreaterThan(held);
  });

  it("再次发消息：已完成任务的进度从 10 重新开始；排队的下一轮不回退", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "completed" });
    await settle();
    expect(taskNow(t).progress).toBe(100);
    await orch.sendToThread(t.threadId, "继续", "normal");
    expect(taskNow(t)).toMatchObject({ status: "running", progress: 10 });

    session().emit({ t: "turn_start", turn: 2 }, { t: "tool", tool: "read", kind: "read", label: "a" }, { t: "tool", tool: "read", kind: "read", label: "b" });
    await settle();
    const mid = taskNow(t).progress!;
    expect(mid).toBeGreaterThan(10);
    await orch.sendToThread(t.threadId, "再排一个", "queue");
    session().emit({ t: "turn_end", status: "completed" }, { t: "turn_start", turn: 3 });
    await settle();
    expect(taskNow(t)).toMatchObject({ status: "running" });
    expect(taskNow(t).progress!).toBeGreaterThanOrEqual(mid);
    expect(taskNow(t).progress!).toBeLessThan(100);
  });

  it("失败的任务不会被标成 100%", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "tool", tool: "read", kind: "read", label: "a" }, { t: "turn_end", status: "failed", error: "炸了" });
    await settle();
    expect(taskNow(t).status).toBe("failed");
    expect(taskNow(t).progress!).toBeLessThan(100);
  });
});

describe("phase 2：用量与成本累加", () => {
  it("多个 turn 的 tokens / costUsd 累加到任务，并累加到所属 bot 的 costWeekUsd", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "completed", usage: { tokens: 100, costUsd: 0.01 } });
    await settle();
    await orch.sendToThread(t.threadId, "再来", "normal");
    session().emit({ t: "turn_start", turn: 2 }, { t: "turn_end", status: "completed", usage: { tokens: 250, costUsd: 0.02 } });
    await settle();
    expect(taskNow(t)).toMatchObject({ tokens: 350 });
    expect(taskNow(t).costUsd).toBeCloseTo(0.03, 6);
    expect(hub.model.bots[BOT]!.costWeekUsd).toBeCloseTo(0.03, 6);
  });

  it("失败 / 被打断的 turn 的用量也计入；没有 costUsd 的 turn 不改 costWeekUsd", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "interrupted", usage: { tokens: 10, costUsd: 0.005 } });
    await settle();
    session().emit({ t: "turn_start", turn: 2 }, { t: "turn_end", status: "failed", error: "x", usage: { tokens: 5 } });
    await settle();
    expect(taskNow(t)).toMatchObject({ tokens: 15, status: "failed" });
    expect(hub.model.bots[BOT]!.costWeekUsd).toBeCloseTo(0.005, 6);
  });

  it("不同任务的成本累加到同一个 bot", async () => {
    const t1 = await start();
    const t2 = await start();
    session(0).emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "completed", usage: { costUsd: 0.1 } });
    session(1).emit({ t: "turn_start", turn: 1 }, { t: "turn_end", status: "completed", usage: { costUsd: 0.2 } });
    await settle();
    expect(hub.model.bots[BOT]!.costWeekUsd).toBeCloseTo(0.3, 6);
    expect(taskNow(t1).costUsd).toBeCloseTo(0.1, 6);
    expect(taskNow(t2).costUsd).toBeCloseTo(0.2, 6);
  });
});

// ───────────────────────── recover / shutdown ─────────────────────────

describe("recover / shutdown", () => {
  it("shutdown 关闭会话但不改任务状态；新编排器 recover 用 resumeNativeId 恢复", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "text_delta", delta: "x" }, { t: "text_done" }, { t: "turn_end", status: "completed" });
    await settle();
    await orch.sendToThread(t.threadId, "继续", "normal");
    await orch.shutdown();
    expect(session().closed).toBe(true);
    expect(taskNow(t).status).toBe("running");
    expect(readFileSync(path.join(tmp, "orchestrator.json"), "utf8")).toContain(session().nativeId);

    orch = build();
    await orch.recover();
    expect(driver.startOpts[1]).toMatchObject({ resumeNativeId: "native-1", cwd: t.cwd });
    expect(taskNow(t).status).toBe("running");
    expect(entriesOf(t).some((e) => e.kind === "system" && e.text.includes("会话已恢复"))).toBe(true);
    expect(hub.model.bots[BOT]!.status).toBe("idle");

    // 恢复后的会话可继续对话，turn 边界也被恢复（可 fork）
    const botEntry = entriesOf(t).find((e) => e.kind === "bot")!;
    await orch.sendToThread(t.threadId, "接着干", "normal");
    expect(session(1).sent).toEqual([{ text: "接着干", mode: "normal" }]);
    const { task } = await orch.handlers["task.fork"]!({ taskId: t.id, entryId: botEntry.id });
    expect(session(1).forks[0]!.atTurn).toBe(1);
    expect(task.forkedFrom?.taskId).toBe(t.id);
  });

  it("恢复失败：任务 failed，system entry“守护进程重启，任务已中断”，bot error，待审批失效", async () => {
    const t = await start();
    session().emit({ t: "turn_start", turn: 1 }, { t: "approval", requestId: "r", title: "运行 x", risk: "low" });
    await settle();
    expect(taskNow(t).status).toBe("waiting_approval");
    await orch.shutdown();

    driver.failStart = "无法恢复";
    orch = build();
    router.onTaskEvent.mockClear();
    await orch.recover();
    expect(taskNow(t).status).toBe("failed");
    expect(entriesOf(t).at(-1)).toMatchObject({ kind: "system", text: "守护进程重启，任务已中断" });
    expect(hub.model.bots[BOT]!.status).toBe("error");
    expect(Object.values(hub.model.approvals)[0]!.status).toBe("expired");
    expect(router.onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ id: t.id }), "failed");
  });

  it("没有持久化记录（orchestrator.json 丢失）：直接标记失败", async () => {
    const t = await start();
    await orch.shutdown();
    rmSync(path.join(tmp, "orchestrator.json"));
    orch = build();
    await orch.recover();
    expect(taskNow(t).status).toBe("failed");
    expect(driver.startOpts).toHaveLength(1);
  });

  it("恢复超时：按失败处理，迟到的会话被关闭", async () => {
    const t = await start();
    await orch.shutdown();
    let release!: (s: DriverSession) => void;
    const late = new Promise<DriverSession>((r) => (release = r));
    driver.start = async () => late;
    orch = build(hub, { recoverTimeoutMs: 30 });
    await orch.recover();
    expect(taskNow(t).status).toBe("failed");
    const s: FakeSession = new FakeSession("late", () => s);
    release(s);
    await settle();
    expect(s.closed).toBe(true);
  });

  it("只恢复 running / waiting_approval；已完成任务不碰", async () => {
    const t = await start();
    await runTurn(t, 1, "ok");
    expect(taskNow(t).status).toBe("done");
    await orch.shutdown();
    orch = build();
    await orch.recover();
    expect(driver.startOpts).toHaveLength(1);
    expect(taskNow(t).status).toBe("done");
  });

  it("router.onTaskEvent 抛错/拒绝不影响编排器", async () => {
    router.onTaskEvent.mockRejectedValue(new Error("router down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await start();
    await runTurn(t, 1, "ok");
    warn.mockRestore();
    expect(taskNow(t).status).toBe("done");
  });
});
