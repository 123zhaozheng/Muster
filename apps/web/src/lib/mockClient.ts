// 完整的离线模拟后端：实现协议里全部方法，所有状态变化都经 applyPush 推送，
// 与真实 daemon 的行为一致（push 严格递增 seq，客户端先 hub.snapshot 再按序应用）。
// 初始世界见 mock/demoData.ts。
//
//  - 主线：chat.send 由"Pip"识别 Bot 名 -> 流式回复 -> 派发卡 + 新任务
//  - 任务：按阶段推进（工具摘要 / 审批 / diff / 测试 / 完成回调），支持 steer / queue / interrupt；
//    运行中的任务不报百分比，只有完成时给 100
//  - fork / branch.adopt、触发器 CRUD 与 fire（观察 / 询问 / 自动三档）、事件、设备配对码
//  - 二期：成员增改删（含原生自建成员）、模型目录 / provider / 模型列表 / 连通测试 / 默认模型（key 只记 hasApiKey）
import type {
  Approval, ApprovalId, Bot, BotId, Branch, DetectedAgent, Entry, EntryId, HubEvent, Methods, MethodName, ModelInfo, ModelProviderConfig,
  ModelRef, ModelSettings, NativeToolGroup, PushPayload, Snapshot, Task, TaskId, Thread, ThreadId, TriggerRule, WireError, WirePush,
} from "@muster/protocol";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "@muster/protocol";
import { applyPush, modelFromSnapshot, snapshotOf, type HubModel } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { buildDemoSeed, diffFor } from "./mock/demoData";
import { parseDispatch } from "./mock/dispatchParser";
import { KEYLESS_PROVIDERS, MOCK_CATALOG, MOCK_MODELS } from "./mock/modelData";

interface MockClientOptions {
  /** 任务脚本两步之间的间隔（毫秒），默认 2200。 */
  stepMs?: number;
  /** 流式回复每个片段的间隔（毫秒），默认 35。 */
  typeMs?: number;
  /** bot.detectAgents 模拟的扫描耗时（毫秒），默认 700。 */
  scanMs?: number;
  /** model.test 的模拟耗时（毫秒）；默认 300~900 随机。 */
  testMs?: number;
}

export interface MockClient extends MusterClient {
  /** 当前内部模型（测试 / 调试用）。 */
  getModel(): HubModel;
}

type Timer = ReturnType<typeof setTimeout>;
type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id" | "threadId" | "ts"> : never) : never;

const DEFAULT_CWD = "D:/work/shop-api";

const SAMPLE_FILES = ["src/payment/callback.ts", "src/payment/signature.ts", "src/order/service.ts", "tests/callback.test.ts", "package.json", "src/config.ts"];

const NEW_BOT_LOOKS: Array<Pick<Bot, "shape" | "color">> = [
  { shape: "round", color: "cream" },
  { shape: "egg", color: "mint" },
  { shape: "blob", color: "sky" },
  { shape: "square", color: "lilac" },
  { shape: "flat", color: "peach" },
];
const ENGINE_LABEL: Record<Exclude<Bot["kind"], "main">, string> = { codex: "Codex", claude: "Claude", acp: "ACP Agent", native: "内置 Bot" };

function fail(code: WireError["code"], message: string): never {
  throw new Error(`${code}: ${message}`);
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 取值唯一的内部状态：一个任务一次"回合"。 */
interface Run {
  taskId: TaskId;
  steps: Step[];
  idx: number;
  dead: boolean;
  timer?: Timer;
  blockedOn?: ApprovalId;
  resume?: () => void;
  steers: Array<{ entryId: EntryId; text: string }>;
  queue: Array<{ entryId: EntryId; text: string }>;
  unattended: boolean;
  autoDeny: boolean;
}
type Step = (r: Run, next: () => void) => void;

export function createMockClient(opts: MockClientOptions = {}): MockClient {
  const stepMs = opts.stepMs ?? 2200;
  const typeMs = opts.typeMs ?? 35;
  const scanMs = opts.scanMs ?? 700;

  const demo = buildDemoSeed(Date.now());
  let model: HubModel = { ...modelFromSnapshot(demo.snapshot), entries: demo.entries };

  const pushHandlers = new Set<(p: WirePush) => void>();
  const statusHandlers = new Set<(s: "connecting" | "open" | "closed") => void>();
  const timers = new Set<Timer>();
  const runs = new Map<TaskId, Run>();
  /** ask 模式触发产生的待确认审批 -> 触发规则与载荷 */
  const triggerApprovals = new Map<ApprovalId, TriggerRule>();
  const firedToday = new Map<string, number>();
  /** 已配置的模型 provider；key 只留在 apiKeys 里，永远不进 model / push。 */
  const providers = new Map<string, ModelProviderConfig>(demo.providers.map((p) => [p.id, p]));
  const apiKeys = new Map<string, string>(Object.entries(demo.apiKeys));
  let disposed = false;
  let counter = 0;
  let lastTs = 0;
  let prNumber = 128;

  const uid = (p: string) => `${p}-m${(++counter).toString(36)}`;
  const now = (): string => {
    lastTs = Math.max(Date.now(), lastTs + 1);
    return new Date(lastTs).toISOString();
  };
  const dayKey = () => new Date().toDateString();

  const later = (ms: number, fn: () => void): Timer => {
    const h = setTimeout(() => {
      timers.delete(h);
      if (!disposed) fn();
    }, ms);
    timers.add(h);
    return h;
  };
  const cancel = (h: Timer | undefined) => {
    if (!h) return;
    clearTimeout(h);
    timers.delete(h);
  };

  // ───────────────────────── 状态变更（一律走 applyPush） ─────────────────────────

  const commit = (push: PushPayload) => {
    model = { ...applyPush(model, push), seq: model.seq + 1 };
    const msg: WirePush = { type: "push", seq: model.seq, push };
    queueMicrotask(() => pushHandlers.forEach((h) => h(msg)));
  };

  const previewOf = (e: Entry): string | undefined => {
    switch (e.kind) {
      case "user": case "steer": case "bot": case "system": return trunc(e.text, 60);
      case "dispatch": return `已派发：${e.title}`;
      case "tool_summary": return `读取了 ${e.reads} 个文件 · 运行了 ${e.commands} 条命令`;
      case "test_result": return e.failed ? `${e.passed} 项通过 · ${e.failed} 项失败` : `${e.passed} 项测试通过`;
      case "diff": return `修改了 ${e.files.length} 个文件`;
      case "approval": return model.approvals[e.approvalId]?.title.replace(/^.+? 想/, "想");
      case "choices": return e.prompt ?? "请选择";
    }
  };

  const touchThread = (threadId: ThreadId, lastText?: string) => {
    const t = model.threads[threadId];
    if (t) commit({ kind: "thread.updated", thread: { ...t, updatedAt: now(), lastText: lastText ?? t.lastText } });
  };

  const append = (threadId: ThreadId, e: NewEntry): Entry => {
    const entry = { ...e, id: uid("e"), threadId, ts: now() } as Entry;
    commit({ kind: "entry.appended", entry });
    touchThread(threadId, previewOf(entry));
    return entry;
  };

  const patchTask = (id: TaskId, patch: Partial<Task>): Task => {
    const t = model.tasks[id];
    if (!t) fail("not_found", `任务 ${id} 不存在`);
    const next = { ...t, ...patch };
    commit({ kind: "task.updated", task: next });
    return next;
  };

  const patchBot = (id: BotId, patch: Partial<Bot>) => {
    const b = model.bots[id];
    if (!b) return;
    const changed = (Object.keys(patch) as Array<keyof Bot>).some((k) => b[k] !== patch[k]);
    if (changed) commit({ kind: "bot.updated", bot: { ...b, ...patch } });
  };

  /** 按名下任务重新推导 Bot 状态。 */
  const recomputeBot = (botId: BotId, finished = false) => {
    const b = model.bots[botId];
    if (!b || b.kind === "main") return;
    const mine = Object.values(model.tasks).filter((t) => t.botId === botId);
    const waiting = mine.find((t) => t.status === "waiting_approval");
    const running = mine.find((t) => t.status === "running");
    if (waiting) patchBot(botId, { status: "waiting_approval", statusDetail: waiting.title });
    else if (running) patchBot(botId, { status: "working", statusDetail: running.title });
    else if (finished) patchBot(botId, { status: "done", statusDetail: undefined });
    else if (b.status === "working" || b.status === "waiting_approval" || b.status === "thinking") patchBot(botId, { status: "idle", statusDetail: undefined });
  };

  const logEvent = (e: Omit<HubEvent, "id" | "ts">): HubEvent => {
    const event: HubEvent = { ...e, id: uid("ev"), ts: now() };
    commit({ kind: "event.logged", event });
    return event;
  };

  // ───────────────────────── 流式回复 ─────────────────────────

  /** 流式追加一条 bot 文本；alive 变假（被打断）时立即收尾且不再回调 done。 */
  const streamBot = (threadId: ThreadId, botId: BotId, text: string, alive: () => boolean, done?: () => void) => {
    const first = append(threadId, { kind: "bot", botId, text: "", streaming: true });
    let i = 0;
    const finish = (final: string) => {
      const cur = model.entries[threadId]?.find((x) => x.id === first.id);
      if (cur && cur.kind === "bot") commit({ kind: "entry.replaced", entry: { ...cur, text: final, streaming: false } });
      touchThread(threadId, trunc(final, 60));
    };
    const tick = () => {
      if (!alive()) {
        const cur = model.entries[threadId]?.find((x) => x.id === first.id);
        finish(cur && cur.kind === "bot" ? cur.text : "");
        return;
      }
      if (i >= text.length) {
        finish(text);
        done?.();
        return;
      }
      commit({ kind: "entry.delta", threadId, entryId: first.id, delta: text.slice(i, i + 3) });
      i += 3;
      later(typeMs, tick);
    };
    later(typeMs, tick);
  };

  /** 流式追加一段思考（界面上折叠展示），收尾时记下用时；被打断时立即收尾且不再回调 done。 */
  const streamThinking = (threadId: ThreadId, botId: BotId, text: string, alive: () => boolean, done?: () => void) => {
    const first = append(threadId, { kind: "thinking", botId, text: "", streaming: true });
    const startedAt = Date.now();
    let i = 0;
    const finish = () => {
      const cur = model.entries[threadId]?.find((x) => x.id === first.id);
      if (cur && cur.kind === "thinking") commit({ kind: "entry.replaced", entry: { ...cur, streaming: false, durationMs: Date.now() - startedAt } });
    };
    const tick = () => {
      if (!alive()) return finish();
      if (i >= text.length) {
        finish();
        done?.();
        return;
      }
      commit({ kind: "entry.delta", threadId, entryId: first.id, delta: text.slice(i, i + 6) });
      i += 6;
      later(typeMs, tick);
    };
    later(typeMs, tick);
  };

  // ───────────────────────── 任务脚本 ─────────────────────────

  const schedule = (r: Run) => {
    r.timer = later(stepMs, () => runStep(r));
  };

  const applySteers = (r: Run) => {
    const task = model.tasks[r.taskId];
    if (!task || r.steers.length === 0) return;
    const pending = r.steers;
    r.steers = [];
    for (const s of pending) {
      const cur = model.entries[task.threadId]?.find((x) => x.id === s.entryId);
      if (cur && cur.kind === "steer") commit({ kind: "entry.replaced", entry: { ...cur, applied: "applied" } });
      append(task.threadId, { kind: "bot", botId: task.botId, text: `收到，我会按你说的调整：「${trunc(s.text, 40)}」` });
    }
  };

  const runStep = (r: Run) => {
    if (r.dead) return;
    applySteers(r);
    const step = r.steps[r.idx++];
    if (!step) return finishTurn(r);
    step(r, () => {
      if (!r.dead) schedule(r);
    });
  };

  const testResultFor = (task: Task) => (task.forkedFrom ? { passed: 11, failed: 1 } : { passed: 12, failed: 0 });

  const finishTurn = (r: Run) => {
    const task = model.tasks[r.taskId];
    if (!task || r.dead) return;
    const queued = r.queue.shift();
    if (queued) {
      const cur = model.entries[task.threadId]?.find((x) => x.id === queued.entryId);
      if (cur && cur.kind === "steer") commit({ kind: "entry.replaced", entry: { ...cur, applied: "applied" } });
      r.steps = followUpSteps(queued.text);
      r.idx = 0;
      schedule(r);
      return;
    }
    r.dead = true;
    runs.delete(r.taskId);
    const done = patchTask(task.id, { status: "done", progress: 100, finishedAt: now() });
    recomputeBot(task.botId, true);
    const tests = testResultFor(done);
    const bot = model.bots[task.botId];
    const botName = bot?.name ?? "子 Bot";
    const summary = bot?.kind === "native" ? `${botName} 完成了「${task.title}」` : `${botName} 完成了「${task.title}」，${tests.passed} 通过 · ${tests.failed} 失败`;
    if (task.parentThreadId === MAIN_THREAD_ID) append(MAIN_THREAD_ID, { kind: "bot", botId: MAIN_BOT_ID, text: summary });
    else append(task.parentThreadId, { kind: "system", text: summary });
    logEvent({ source: "callback", title: `回调 · ${botName} 完成了 ${task.title}`, detail: "处理完成，状态已更新", botId: task.botId, taskId: task.id, status: "delivered" });

    const br = Object.values(model.branches).find((b) => b.taskId === task.id);
    if (br && bot?.kind !== "native") {
      const diff = [...(model.entries[task.threadId] ?? [])].reverse().find((e) => e.kind === "diff");
      commit({
        kind: "branch.updated",
        branch: { ...br, filesChanged: diff?.kind === "diff" ? diff.files.length : br.filesChanged, tests, tokens: done.tokens ?? br.tokens, summary: !br.summary || br.summary.startsWith("正在探索") ? `${task.title}：已完成。` : br.summary },
      });
    }
  };

  /** 记一笔用量：任务的 token / 花费增加，成员的周花费同步增加，保证成本始终等于名下任务之和。 */
  const bump = (taskId: TaskId) => {
    const t = model.tasks[taskId];
    if (!t) return;
    patchTask(taskId, { tokens: (t.tokens ?? 0) + 6_000, costUsd: Math.round(((t.costUsd ?? 0) + 0.03) * 100) / 100 });
    const b = model.bots[t.botId];
    if (b) patchBot(b.id, { costWeekUsd: Math.round((b.costWeekUsd + 0.03) * 100) / 100 });
  };

  const toolSummary = (task: Task, reads: number, commands: number, edits: number): NewEntry => ({
    kind: "tool_summary",
    botId: task.botId,
    reads,
    commands,
    edits,
    items: [
      ...SAMPLE_FILES.slice(0, Math.min(reads, 3)).map((label) => ({ tool: "read", label, ok: true })),
      ...(commands > 0 ? [{ tool: "bash", label: "pnpm test", ok: true }] : []),
      ...(edits > 0 ? [{ tool: "edit", label: SAMPLE_FILES[0] ?? "src/index.ts", ok: true }] : []),
    ],
  });

  const approvalStep: Step = (r, next) => {
    const task = model.tasks[r.taskId];
    if (!task) return;
    const bot = model.bots[task.botId];
    const ap: Approval = {
      id: uid("ap"),
      botId: task.botId,
      taskId: task.id,
      title: `${bot?.name ?? "子 Bot"} 想运行 pnpm install`,
      detail: "pnpm install --frozen-lockfile",
      risk: "medium",
      status: "pending",
      createdAt: now(),
      ...(r.unattended ? { unattended: true } : {}),
    };
    commit({ kind: "approval.created", approval: ap });
    append(task.threadId, { kind: "approval", approvalId: ap.id });
    r.blockedOn = ap.id;
    r.resume = next;
    patchTask(task.id, { status: "waiting_approval" });
    recomputeBot(task.botId);
    if (r.unattended && r.autoDeny) resolveApproval(ap.id, "deny", true);
  };

  /** 编程类成员（Codex / Claude / ACP）的主回合：读代码 -> 审批 -> 改动 -> diff -> 测试 -> 收尾。 */
  const codeSteps = (task: Task, withApproval: boolean): Step[] => [
    (r, next) => {
      bump(task.id);
      const alive = () => !r.dead;
      streamThinking(task.threadId, task.botId, `要做的是「${task.title}」。先读相关模块和已有测试，弄清现状再改，改完跑一遍测试确认。`, alive, () =>
        streamBot(task.threadId, task.botId, `我来处理「${task.title}」，先梳理一下相关代码结构…`, alive, next),
      );
    },
    (_r, next) => {
      bump(task.id);
      append(task.threadId, toolSummary(task, 6, 2, 0));
      next();
    },
    ...(withApproval ? [approvalStep] : []),
    (r, next) => {
      bump(task.id);
      append(task.threadId, toolSummary(task, 4, 1, 2));
      streamBot(task.threadId, task.botId, "定位到原因了，开始修改并补充测试。", () => !r.dead, next);
    },
    (_r, next) => {
      bump(task.id);
      append(task.threadId, { kind: "diff", botId: task.botId, files: diffFor(task.title) });
      next();
    },
    (r, next) => {
      bump(task.id);
      const tests = testResultFor(task);
      append(task.threadId, { kind: "test_result", botId: task.botId, ...tests });
      streamBot(task.threadId, task.botId, `「${task.title}」已完成，改动已写入工作区（${tests.passed} 通过 · ${tests.failed} 失败）。`, () => !r.dead, next);
    },
  ];

  /** 原生成员（只读文件 / 网页）的主回合：检索 -> 整理 -> 结论，不改代码、不跑测试。 */
  const researchSteps = (task: Task): Step[] => [
    (r, next) => {
      bump(task.id);
      const alive = () => !r.dead;
      streamThinking(task.threadId, task.botId, `「${task.title}」需要可靠的公开资料。先列出关键词，再挑几个权威来源交叉核对。`, alive, () =>
        streamBot(task.threadId, task.botId, `我来处理「${task.title}」，先检索相关资料。`, alive, next),
      );
    },
    (_r, next) => {
      bump(task.id);
      append(task.threadId, { kind: "tool_summary", botId: task.botId, reads: 8, commands: 0, edits: 0, items: [{ tool: "web", label: "公开资料与网页", ok: true }] });
      next();
    },
    (r, next) => {
      bump(task.id);
      streamBot(task.threadId, task.botId, "资料已读完，正在整理要点与出处。", () => !r.dead, next);
    },
    (r, next) => {
      bump(task.id);
      streamBot(task.threadId, task.botId, `「${task.title}」已整理完成，要点和出处都写在上面了。`, () => !r.dead, next);
    },
  ];

  const mainSteps = (task: Task, withApproval: boolean): Step[] =>
    model.bots[task.botId]?.kind === "native" ? researchSteps(task) : codeSteps(task, withApproval);

  /** 插话 / 排队 / 打断之后的小回合。 */
  const followUpSteps = (text: string): Step[] => {
    const taskOf = (r: Run) => model.tasks[r.taskId];
    return [
      (r, next) => {
        const t = taskOf(r);
        if (!t) return;
        bump(t.id);
        streamBot(t.threadId, t.botId, `收到：「${trunc(text, 40)}」，我来处理。`, () => !r.dead, next);
      },
      (r, next) => {
        const t = taskOf(r);
        if (!t) return;
        bump(t.id);
        append(t.threadId, toolSummary(t, 3, 1, 1));
        streamBot(t.threadId, t.botId, "已处理完成，改动已写入工作区。", () => !r.dead, next);
      },
    ];
  };

  const startRun = (taskId: TaskId, steps: Step[], carry?: Pick<Run, "queue" | "steers">, flags?: Pick<Run, "unattended" | "autoDeny">): Run => {
    const old = runs.get(taskId);
    const r: Run = {
      taskId,
      steps,
      idx: 0,
      dead: false,
      steers: carry?.steers ?? old?.steers ?? [],
      queue: carry?.queue ?? old?.queue ?? [],
      unattended: flags?.unattended ?? old?.unattended ?? false,
      autoDeny: flags?.autoDeny ?? old?.autoDeny ?? false,
    };
    runs.set(taskId, r);
    return r;
  };

  const killRun = (taskId: TaskId, expireApproval: boolean) => {
    const r = runs.get(taskId);
    if (!r) return;
    r.dead = true;
    cancel(r.timer);
    runs.delete(taskId);
    const ap = r.blockedOn ? model.approvals[r.blockedOn] : undefined;
    if (expireApproval && ap && ap.status === "pending") commit({ kind: "approval.updated", approval: { ...ap, status: "expired", resolvedAt: now() } });
    return r;
  };

  // ───────────────────────── 创建任务 / 派发 ─────────────────────────

  const createTask = (o: {
    bot: Bot;
    title: string;
    parentThreadId: ThreadId;
    forkedFrom?: Task["forkedFrom"];
    approval: boolean;
    unattended?: boolean;
    autoDeny?: boolean;
    intro: string;
  }): Task => {
    const suffix = uid("t");
    const slug = o.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const startedAt = now();
    const taskId = `task-${suffix}`;
    const thread: Thread = { id: `thread-${suffix}`, title: o.title, botId: o.bot.id, taskId, createdAt: startedAt, updatedAt: startedAt, lastText: "排队中" };
    const task: Task = {
      id: taskId,
      title: o.title,
      botId: o.bot.id,
      threadId: thread.id,
      parentThreadId: o.parentThreadId,
      status: "running",
      ...(o.bot.kind === "native" ? {} : { cwd: DEFAULT_CWD, branch: `muster/${slug || suffix}` }),
      ...(o.forkedFrom ? { forkedFrom: o.forkedFrom } : {}),
      startedAt,
      tokens: 0,
      costUsd: 0,
    };
    commit({ kind: "thread.updated", thread });
    commit({ kind: "task.updated", task });
    append(thread.id, { kind: "system", text: o.intro });
    recomputeBot(o.bot.id);
    const run = startRun(taskId, mainSteps(task, o.approval && o.bot.kind !== "native"), { queue: [], steers: [] }, { unattended: !!o.unattended, autoDeny: !!o.autoDeny });
    schedule(run);
    return task;
  };

  // ───────────────────────── 审批 ─────────────────────────

  const resolveApproval = (id: ApprovalId, decision: "allow" | "deny", auto = false): Approval => {
    const ap = model.approvals[id];
    if (!ap) fail("not_found", `审批 ${id} 不存在`);
    if (ap.status !== "pending") fail("conflict", "该审批已处理");
    const next: Approval = { ...ap, status: decision === "allow" ? "allowed" : "denied", resolvedAt: now() };
    commit({ kind: "approval.updated", approval: next });
    logEvent(
      auto
        ? { source: "system", title: `系统 · 无人值守，已自动拒绝：${ap.title}`, botId: ap.botId, ...(ap.taskId ? { taskId: ap.taskId } : {}), status: "recorded" }
        : { source: "user", title: `你 · ${decision === "allow" ? "允许" : "拒绝"}了：${ap.title}`, botId: ap.botId, ...(ap.taskId ? { taskId: ap.taskId } : {}), status: "delivered" },
    );

    const trigRule = triggerApprovals.get(id);
    if (trigRule) {
      triggerApprovals.delete(id);
      if (decision === "allow") {
        const task = dispatchFromTrigger(trigRule, false);
        logEvent({ source: trigRule.source, title: `你 · 确认了触发「${trigRule.label}」`, detail: "已派发给 Bot", botId: trigRule.targetBotId, triggerId: trigRule.id, ...(task ? { taskId: task.id } : {}), status: "dispatched" });
      } else {
        logEvent({ source: trigRule.source, title: `你 · 拒绝了触发「${trigRule.label}」`, botId: trigRule.targetBotId, triggerId: trigRule.id, status: "ignored" });
      }
      return next;
    }

    const r = ap.taskId ? runs.get(ap.taskId) : undefined;
    if (r && r.blockedOn === id) {
      r.blockedOn = undefined;
      const task = model.tasks[r.taskId];
      if (task) {
        patchTask(task.id, { status: "running" });
        recomputeBot(task.botId);
        append(task.threadId, {
          kind: "bot",
          botId: task.botId,
          text: decision === "allow" ? "已获批准，继续执行。" : auto ? "无人值守，命令被自动拒绝，我换一种方式继续。" : "好的，不运行这条命令，我换一种方式继续。",
        });
      }
      const resume = r.resume;
      r.resume = undefined;
      resume?.();
    }
    return next;
  };

  // ───────────────────────── 触发器 ─────────────────────────

  const dispatchFromTrigger = (rule: TriggerRule, unattended: boolean): Task | undefined => {
    const bot = model.bots[rule.targetBotId];
    if (!bot) return undefined;
    const task = createTask({
      bot,
      title: rule.label.replace(/^当\s*/, ""),
      parentThreadId: MAIN_THREAD_ID,
      approval: true,
      unattended,
      autoDeny: rule.autoDenyApprovalsWhenUnattended,
      intro: `由触发规则「${rule.label}」派发`,
    });
    append(MAIN_THREAD_ID, { kind: "dispatch", botId: bot.id, taskId: task.id, title: task.title });
    return task;
  };

  const fireTrigger = (rule: TriggerRule, payload: Record<string, unknown> = {}): HubEvent => {
    const bot = model.bots[rule.targetBotId];
    const botName = bot?.name ?? "Bot";
    const key = `${rule.id}:${dayKey()}`;
    const count = firedToday.get(key) ?? 0;
    firedToday.set(key, count + 1);

    let title: string;
    switch (rule.source) {
      case "github": {
        const repo = rule.params.repo ?? "repo";
        const n = typeof payload.number === "number" ? payload.number : ++prNumber;
        const evt = rule.params.event ?? "";
        title = evt.startsWith("pull_request") ? `GitHub · PR #${n} 已打开 · ${repo}` : evt.startsWith("issues") ? `GitHub · Issue #${n} 已创建 · ${repo}` : `GitHub · ${evt || "事件"} · ${repo}`;
        break;
      }
      case "cron": title = `定时 · ${rule.label}`; break;
      case "device": title = `设备 · ${model.devices[rule.params.deviceId ?? ""]?.name ?? "设备"} 上线`; break;
      case "callback": title = `回调 · ${rule.label}`; break;
    }
    if (typeof payload.title === "string" && payload.title) title = payload.title;

    commit({ kind: "trigger.updated", trigger: { ...rule, lastFiredAt: now() } });
    const base = { source: rule.source, title, botId: rule.targetBotId, triggerId: rule.id } as const;

    if (count >= rule.dailyBudget) return logEvent({ ...base, detail: `已达今日预算（${rule.dailyBudget} 次），本次未执行`, status: "ignored" });
    switch (rule.mode) {
      case "observe":
        return logEvent({ ...base, detail: `观察模式：已记录将会做什么 → 让 ${botName} ${rule.label.replace(/^当\s*/, "处理：")}`, status: "recorded" });
      case "ask": {
        const ap: Approval = {
          id: uid("ap"),
          botId: rule.targetBotId,
          title: `${botName} 想响应触发「${rule.label}」`,
          detail: title,
          risk: "low",
          status: "pending",
          createdAt: now(),
        };
        triggerApprovals.set(ap.id, rule);
        commit({ kind: "approval.created", approval: ap });
        return logEvent({ ...base, detail: `询问模式：等你确认后才会派发给 ${botName}`, status: "recorded" });
      }
      case "auto": {
        const task = dispatchFromTrigger(rule, true);
        return logEvent({ ...base, detail: `自动模式：已派发给 ${botName}`, ...(task ? { taskId: task.id } : {}), status: task ? "dispatched" : "failed" });
      }
    }
  };

  // ───────────────────────── 主线：Pip ─────────────────────────

  /** Pip 回复；给了 thought 时先流式输出一段思考。 */
  const pipSay = (text: string, then?: () => void, thought?: string) => {
    patchBot(MAIN_BOT_ID, { status: "thinking" });
    const alive = () => !disposed;
    const say = () =>
      streamBot(MAIN_THREAD_ID, MAIN_BOT_ID, text, alive, () => {
        patchBot(MAIN_BOT_ID, { status: "idle" });
        then?.();
      });
    if (thought) streamThinking(MAIN_THREAD_ID, MAIN_BOT_ID, thought, alive, say);
    else say();
  };

  const handleMain = (text: string): Entry => {
    const entry = append(MAIN_THREAD_ID, { kind: "user", text });
    logEvent({ source: "user", title: `你 · ${trunc(text, 30)}`, botId: MAIN_BOT_ID, status: "delivered" });
    const subs = Object.values(model.bots).filter((b) => b.kind !== "main");
    const intents = parseDispatch(text, Object.values(model.bots));

    if (intents.length === 0) {
      if (/顺便跑测试|完成后通知我/.test(text)) {
        later(typeMs * 4, () => pipSay(`好的，已记下：${text}。`));
      } else {
        later(typeMs * 4, () =>
          pipSay("我只负责分发任务。告诉我「交给小码修 xx」这样的话，我就帮你安排。", () =>
            append(MAIN_THREAD_ID, { kind: "choices", prompt: "想交给谁？", options: subs.map((b) => `交给${b.name}`) }),
          ),
        );
      }
      return entry;
    }

    const plan = intents.map((it) => `「${it.title}」交给${it.bot.name}`).join("，");
    later(typeMs * 4, () =>
      pipSay("好的，我来安排一下：", () => {
        intents.forEach((it, i) =>
          later(i * 350, () => {
            const task = createTask({ bot: it.bot, title: it.title, parentThreadId: MAIN_THREAD_ID, approval: true, intro: `Pip 派发了任务：${it.title}` });
            append(MAIN_THREAD_ID, { kind: "dispatch", botId: it.bot.id, taskId: task.id, title: it.title });
            logEvent({ source: "user", title: `你 · 派发 给 ${it.bot.name}`, detail: it.title, botId: it.bot.id, taskId: task.id, status: "dispatched" });
          }),
        );
        later(intents.length * 350, () => append(MAIN_THREAD_ID, { kind: "choices", options: ["顺便跑测试", "完成后通知我"], multi: true }));
      }, `用户点名了要做的事：${plan}。各自独立，可以并行派发。`),
    );
    return entry;
  };

  const handleSubThread = (thread: Thread, text: string, mode: NonNullable<Methods["chat.send"]["params"]["mode"]>): Entry => {
    const task = thread.taskId ? model.tasks[thread.taskId] : undefined;
    if (!task) {
      // 没有任务的 Bot 线程：简单对话
      const entry = append(thread.id, { kind: "user", text });
      const owner = model.bots[thread.botId];
      const reply = owner?.kind === "native" && !effectiveModelOf(owner)
        ? "我还没有可用的模型。请先到「设置 · 模型」添加服务商并选好默认模型，或在成员设置里给我指定一个模型。"
        : `收到：「${trunc(text, 40)}」`;
      later(typeMs * 4, () => streamBot(thread.id, thread.botId, reply, () => !disposed));
      return entry;
    }
    const busy = task.status === "running" || task.status === "waiting_approval";
    if (!busy) {
      const entry = append(thread.id, { kind: "user", text });
      patchTask(task.id, { status: "running", progress: undefined, finishedAt: undefined });
      recomputeBot(task.botId);
      schedule(startRun(task.id, followUpSteps(text), { queue: [], steers: [] }));
      return entry;
    }
    const r = runs.get(task.id);
    if (mode === "interrupt") {
      const carried = killRun(task.id, true);
      const entry = append(thread.id, { kind: "steer", text, mode: "interrupt", applied: "applied" });
      patchTask(task.id, { status: "running" });
      recomputeBot(task.botId);
      schedule(startRun(task.id, followUpSteps(text), { queue: carried?.queue ?? [], steers: [] }));
      return entry;
    }
    if (mode === "steer") {
      const entry = append(thread.id, { kind: "steer", text, mode: "steer", applied: "next_step" });
      r?.steers.push({ entryId: entry.id, text });
      return entry;
    }
    // normal（忙碌时）与 queue 一样排队
    const entry = append(thread.id, { kind: "steer", text, mode: "queue", applied: "pending" });
    r?.queue.push({ entryId: entry.id, text });
    return entry;
  };

  // ───────────────────────── fork / 分支 ─────────────────────────

  const rootOf = (t: Task): TaskId => {
    let cur = t;
    for (let i = 0; i < 20 && cur.forkedFrom; i++) {
      const up = model.tasks[cur.forkedFrom.taskId];
      if (!up) return cur.forkedFrom.taskId;
      cur = up;
    }
    return cur.id;
  };
  const familyBranches = (taskId: TaskId): Branch[] => {
    const t = model.tasks[taskId];
    if (!t) return [];
    const root = rootOf(t);
    const ids = new Set(Object.values(model.tasks).filter((x) => rootOf(x) === root).map((x) => x.id));
    return Object.values(model.branches).filter((b) => ids.has(b.taskId));
  };

  const forkTask = (p: Methods["task.fork"]["params"]): Methods["task.fork"]["result"] => {
    const src = model.tasks[p.taskId];
    if (!src) fail("not_found", `任务 ${p.taskId} 不存在`);
    const list = model.entries[src.threadId] ?? [];
    const at = list.findIndex((e) => e.id === p.entryId);
    if (at < 0) fail("not_found", `条目 ${p.entryId} 不在该任务的会话中`);
    const bot = model.bots[p.botId ?? src.botId];
    if (!bot || bot.kind === "main") fail("bad_request", "无效的 Bot");

    // 首次分支时，原任务补一条"分支 A"，方便对比
    if (!src.forkedFrom && !Object.values(model.branches).some((b) => b.taskId === src.id)) {
      // 原任务可能已经跑完：把当前的改动文件数 / 测试结果 / token 一并带上
      const lastDiff = [...list].reverse().find((e) => e.kind === "diff");
      const base: Branch = {
        id: uid("br"),
        taskId: src.id,
        forkEntryId: p.entryId,
        label: "分支 A：原方案",
        botId: src.botId,
        summary: `${src.title}：当前方案。`,
        filesChanged: lastDiff?.kind === "diff" ? lastDiff.files.length : 0,
        ...(src.status === "done" ? { tests: testResultFor(src) } : {}),
        ...(src.tokens ? { tokens: src.tokens } : {}),
      };
      commit({ kind: "branch.updated", branch: base });
    }
    const letter = String.fromCharCode(65 + familyBranches(src.id).length);
    const label = p.label?.trim() || "新方案";
    const task = createTask({
      bot,
      title: `${src.title}（${label}）`,
      parentThreadId: src.threadId,
      forkedFrom: { taskId: src.id, entryId: p.entryId },
      approval: false,
      intro: `已从「${src.title}」的第 ${at + 1} 步分支出来：${label}`,
    });
    const branch: Branch = { id: uid("br"), taskId: task.id, forkEntryId: p.entryId, label: `分支 ${letter}：${label}`, botId: bot.id, summary: "正在探索新的方案…", filesChanged: 0 };
    commit({ kind: "branch.updated", branch });
    logEvent({ source: "user", title: `你 · 从「${src.title}」分支`, detail: branch.label, botId: bot.id, taskId: task.id, status: "dispatched" });
    return { task: model.tasks[task.id] ?? task, branch };
  };

  // ───────────────────────── 让初始世界里"进行中"的任务继续推进 ─────────────────────────

  /** 种子会话已经覆盖的阶段数：这些阶段不再重复。等你确认的任务先挂起，不自行推进。 */
  const SEEDED_STAGES: Record<TaskId, number> = { "task-refund-api": 2, "task-hiring-research": 2 };

  const initRuns = () => {
    for (const task of Object.values(model.tasks)) {
      if (task.status !== "running" && task.status !== "waiting_approval") continue;
      const run = startRun(task.id, mainSteps(task, false).slice(SEEDED_STAGES[task.id] ?? 0), { queue: [], steers: [] });
      const pending = Object.values(model.approvals).find((a) => a.taskId === task.id && a.status === "pending");
      if (task.status === "waiting_approval" && pending) {
        run.blockedOn = pending.id;
        run.resume = () => schedule(run);
      } else {
        schedule(run);
      }
    }
  };

  // ───────────────────────── 模型（二期） ─────────────────────────

  const NATIVE_TOOLS: NativeToolGroup[] = ["files", "edit", "shell", "web"];
  const catalogOf = (id: string) => MOCK_CATALOG.find((c) => c.id === id);
  const publishModels = (settings: ModelSettings = model.modelSettings ?? {}) => commit({ kind: "models.changed", settings });

  const modelsOf = (providerId: string): ModelInfo[] => {
    const cfg = providers.get(providerId);
    if (!cfg) return [];
    if (cfg.kind !== "builtin") return (cfg.modelIds ?? []).map((id) => ({ provider: cfg.id, id, name: id }));
    const table = MOCK_MODELS[cfg.builtinId ?? cfg.id] ?? [];
    const picked = cfg.modelIds?.length ? cfg.modelIds.map((id) => table.find((x) => x.id === id) ?? { id, name: id }) : table;
    return picked.map((x) => ({ provider: cfg.id, ...x }));
  };

  const isRef = (r: unknown): r is ModelRef => {
    const x = r as ModelRef | null | undefined;
    return !!x && typeof x.provider === "string" && !!x.provider && typeof x.modelId === "string" && !!x.modelId;
  };

  /** 成员 / 默认模型引用必须指向存在的 provider。 */
  const requireProvider = (ref: unknown, what: string): ModelRef => {
    if (!isRef(ref)) fail("bad_request", `${what} 需要 provider 与 modelId`);
    if (!providers.has(ref.provider)) fail("bad_request", `服务商 "${ref.provider}" 不存在`);
    return { provider: ref.provider, modelId: ref.modelId };
  };

  const cleanUrl = (url: string | undefined, required: boolean): string | undefined => {
    const v = url?.trim();
    if (!v) {
      if (required) fail("bad_request", "请填写 baseUrl，例如 http://localhost:11434/v1");
      return undefined;
    }
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      fail("bad_request", `baseUrl 不是有效的网址：${v}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("bad_request", "baseUrl 必须以 http:// 或 https:// 开头");
    return v.replace(/\/+$/, "");
  };

  const uniqueIds = (ids: string[] | undefined): string[] | undefined => {
    const out = [...new Set((ids ?? []).map((s) => String(s).trim()).filter(Boolean))];
    return out.length ? out : undefined;
  };

  /** 当前成员实际使用的模型：自己的 > 原生默认；provider 不存在或已停用则为空。 */
  const effectiveModelOf = (bot: Bot): ModelRef | undefined => {
    const ref = bot.model ?? model.modelSettings?.native;
    return ref && providers.get(ref.provider)?.enabled ? ref : undefined;
  };

  const checkTools = (tools: unknown): NativeToolGroup[] => {
    if (!Array.isArray(tools) || tools.some((t) => !NATIVE_TOOLS.includes(t as NativeToolGroup))) fail("bad_request", "tools 只能包含 files / edit / shell / web");
    return [...new Set(tools as NativeToolGroup[])];
  };

  // ───────────────────────── 方法表 ─────────────────────────

  type Impl = { [M in MethodName]: (p: Methods[M]["params"]) => Promise<Methods[M]["result"]> | Methods[M]["result"] };

  const impl: Impl = {
    "hub.snapshot": (): Snapshot => ({ ...snapshotOf(model), serverTime: new Date().toISOString() }),

    "thread.get": (p) => {
      let thread = model.threads[p.threadId];
      if (!thread) {
        // Bot 自己的线程可能还没有任何记录
        const bot = Object.values(model.bots).find((b) => b.threadId === p.threadId);
        if (!bot) fail("not_found", `线程 ${p.threadId} 不存在`);
        const ts = now();
        thread = { id: bot.threadId, title: bot.name, botId: bot.id, createdAt: ts, updatedAt: ts };
      }
      const all = model.entries[p.threadId] ?? [];
      return { thread, entries: p.limit && p.limit > 0 ? all.slice(-p.limit) : all.slice() };
    },

    "chat.send": (p) => {
      const text = p.text.trim();
      if (!text) fail("bad_request", "消息不能为空");
      const thread = model.threads[p.threadId];
      if (!thread) {
        const bot = Object.values(model.bots).find((b) => b.threadId === p.threadId);
        if (!bot) fail("not_found", `线程 ${p.threadId} 不存在`);
        const ts = now();
        commit({ kind: "thread.updated", thread: { id: bot.threadId, title: bot.name, botId: bot.id, createdAt: ts, updatedAt: ts } });
      }
      const th = model.threads[p.threadId]!;
      const entry = th.id === MAIN_THREAD_ID ? handleMain(text) : handleSubThread(th, text, p.mode ?? "normal");
      return { entryId: entry.id };
    },

    "task.interrupt": (p) => {
      const task = model.tasks[p.taskId];
      if (!task) fail("not_found", `任务 ${p.taskId} 不存在`);
      if (task.status !== "running" && task.status !== "waiting_approval") fail("conflict", "任务当前没有在运行");
      killRun(task.id, true);
      patchTask(task.id, { status: "queued" });
      recomputeBot(task.botId);
      append(task.threadId, { kind: "system", text: "已打断当前回合，等待新的指令" });
      return { ok: true };
    },

    "task.cancel": (p) => {
      const task = model.tasks[p.taskId];
      if (!task) fail("not_found", `任务 ${p.taskId} 不存在`);
      if (task.status === "done" || task.status === "failed" || task.status === "cancelled") fail("conflict", "任务已结束");
      killRun(task.id, true);
      patchTask(task.id, { status: "cancelled", finishedAt: now() });
      recomputeBot(task.botId);
      append(task.threadId, { kind: "system", text: "任务已取消" });
      return { ok: true };
    },

    "task.fork": forkTask,

    "task.branches": (p) => {
      if (!model.tasks[p.taskId]) fail("not_found", `任务 ${p.taskId} 不存在`);
      return { branches: familyBranches(p.taskId) };
    },

    "branch.adopt": (p) => {
      const target = model.branches[p.branchId];
      if (!target) fail("not_found", `分支 ${p.branchId} 不存在`);
      for (const b of familyBranches(target.taskId)) {
        const adopted = b.id === target.id;
        if (!!b.adopted !== adopted) commit({ kind: "branch.updated", branch: { ...b, adopted } });
      }
      const task = model.tasks[target.taskId];
      logEvent({ source: "user", title: `你 · 采用了「${target.label}」`, botId: target.botId, taskId: target.taskId, status: "recorded" });
      if (task) append(task.threadId, { kind: "system", text: `已采用「${target.label}」` });
      return { branch: model.branches[target.id]! };
    },

    "approval.resolve": (p) => ({ approval: resolveApproval(p.approvalId, p.decision) }),

    "trigger.list": () => ({ triggers: Object.values(model.triggers) }),

    "trigger.upsert": (p) => {
      const t = p.trigger;
      if (!t.label?.trim()) fail("bad_request", "规则名称不能为空");
      if (!model.bots[t.targetBotId]) fail("bad_request", `目标 Bot ${t.targetBotId} 不存在`);
      if (!["observe", "ask", "auto"].includes(t.mode)) fail("bad_request", "无效的模式");
      if (!(t.dailyBudget >= 0)) fail("bad_request", "每日预算必须是非负数");
      const existing = t.id ? model.triggers[t.id] : undefined;
      const trigger: TriggerRule = { ...existing, ...t, id: t.id ?? uid("tr") };
      commit({ kind: "trigger.updated", trigger });
      return { trigger };
    },

    "trigger.delete": (p) => {
      if (!model.triggers[p.triggerId]) fail("not_found", `触发规则 ${p.triggerId} 不存在`);
      commit({ kind: "trigger.deleted", triggerId: p.triggerId });
      return { ok: true };
    },

    "trigger.fire": (p) => {
      const rule = model.triggers[p.triggerId];
      if (!rule) fail("not_found", `触发规则 ${p.triggerId} 不存在`);
      return { eventId: fireTrigger(rule, p.payload).id };
    },

    "event.list": (p) => {
      const limit = p.limit && p.limit > 0 ? p.limit : 50;
      const events = model.events.filter((e) => (!p.source || e.source === p.source) && (!p.before || e.ts < p.before));
      return { events: events.slice(0, limit) };
    },

    "bot.detectAgents": async () => {
      if (scanMs > 0) await new Promise<void>((resolve) => later(scanMs, resolve));
      const agents: DetectedAgent[] = [
        { engine: "codex", command: "codex", version: "0.52.0", found: true },
        { engine: "claude", command: "claude", version: "2.0.31", found: true },
        { engine: "opencode", command: "opencode", found: false },
      ];
      return { agents };
    },

    "bot.add": (p) => {
      const name = p.name.trim();
      if (!name) fail("bad_request", "名字不能为空");
      if (Object.values(model.bots).some((b) => b.name === name)) fail("conflict", `已经有叫「${name}」的成员了`);
      const subs = Object.values(model.bots).filter((b) => b.kind !== "main").length;
      const look = NEW_BOT_LOOKS[subs % NEW_BOT_LOOKS.length]!;
      const id = uid("bot");
      const bot: Bot = {
        id,
        name,
        kind: p.kind,
        engineLabel: p.engineLabel ?? ENGINE_LABEL[p.kind],
        ...(p.tagline?.trim() ? { tagline: p.tagline.trim() } : {}),
        shape: p.shape ?? look.shape,
        color: p.color ?? look.color,
        status: "idle",
        skills: p.skills ?? [],
        costWeekUsd: 0,
        threadId: `thread-${id}`,
        ...(p.persona?.trim() ? { persona: p.persona.trim() } : {}),
        ...(p.model ? { model: requireProvider(p.model, "model") } : {}),
        ...(p.tools ? { tools: checkTools(p.tools) } : p.kind === "native" ? { tools: ["files"] as NativeToolGroup[] } : {}),
        builtin: false,
      };
      commit({ kind: "bot.added", bot });
      return { bot };
    },

    "bot.update": (p) => {
      const cur = model.bots[p.botId];
      if (!cur) fail("not_found", `成员 ${p.botId} 不存在`);
      const patch = p.patch ?? {};
      const next: Bot = { ...cur };
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) fail("bad_request", "名字不能为空");
        if (Object.values(model.bots).some((b) => b.id !== cur.id && b.name === name)) fail("conflict", `已经有叫「${name}」的成员了`);
        next.name = name;
      }
      if (patch.engineLabel !== undefined) next.engineLabel = patch.engineLabel.trim() || cur.engineLabel;
      if (patch.shape !== undefined) next.shape = patch.shape;
      if (patch.color !== undefined) next.color = patch.color;
      if (patch.skills !== undefined) next.skills = patch.skills;
      if ("tagline" in patch) {
        const v = patch.tagline?.trim();
        if (v) next.tagline = v;
        else delete next.tagline;
      }
      if ("persona" in patch) {
        const v = patch.persona?.trim();
        if (v) next.persona = v;
        else delete next.persona;
      }
      if ("model" in patch) {
        if (patch.model) next.model = requireProvider(patch.model, "model");
        else delete next.model;
      }
      if ("tools" in patch) {
        if (patch.tools) next.tools = checkTools(patch.tools);
        else delete next.tools;
      }
      commit({ kind: "bot.updated", bot: next });
      return { bot: next };
    },

    "bot.remove": (p) => {
      const cur = model.bots[p.botId];
      if (!cur) fail("not_found", `成员 ${p.botId} 不存在`);
      if (cur.kind === "main" || cur.builtin) fail("bad_request", `「${cur.name}」是内置成员，不能删除（可以编辑）`);
      if (Object.values(model.tasks).some((t) => t.botId === cur.id && (t.status === "running" || t.status === "waiting_approval"))) {
        fail("conflict", `「${cur.name}」还有进行中的任务，请先取消或等它完成`);
      }
      commit({ kind: "bot.removed", botId: cur.id });
      return { ok: true };
    },

    // ── 模型（二期） ──

    "model.catalog": () => ({ providers: MOCK_CATALOG.map((c) => ({ ...c, envConfigured: false })) }),

    "model.providers": () => ({ providers: [...providers.values()].map((c) => ({ ...c })), settings: { ...(model.modelSettings ?? {}) } }),

    "model.providerUpsert": (p) => {
      const input = p?.provider;
      if (!input || typeof input !== "object") fail("bad_request", "缺少 provider");
      if (!["builtin", "openai-compatible", "anthropic-compatible"].includes(input.kind)) fail("bad_request", `未知的 provider 类型：${String(input.kind)}`);
      let key: string | undefined;
      if (p.apiKey !== undefined) {
        key = String(p.apiKey).trim();
        if (/\s/.test(key)) fail("bad_request", "API Key 不能包含空格或换行，请检查是否多复制了内容");
      }

      let cfg: Omit<ModelProviderConfig, "hasApiKey">;
      if (input.kind === "builtin") {
        const builtinId = input.builtinId ?? input.id;
        const base = builtinId ? catalogOf(builtinId) : undefined;
        if (!builtinId || !base) fail("bad_request", `内置服务商目录中没有 "${String(builtinId)}"`);
        if (input.id && input.id !== builtinId) fail("bad_request", "内置服务商的 id 必须等于 builtinId");
        const url = cleanUrl(input.baseUrl, false);
        cfg = {
          id: builtinId,
          kind: "builtin",
          builtinId,
          name: input.name?.trim() || base.name,
          ...(url && url !== base.baseUrl ? { baseUrl: url } : {}),
          enabled: input.enabled !== false,
          ...(uniqueIds(input.modelIds) ? { modelIds: uniqueIds(input.modelIds) } : {}),
          createdAt: providers.get(builtinId)?.createdAt ?? now(),
        };
      } else {
        const id = input.id ?? uid("custom");
        if (!/^custom-[a-z0-9-]+$/.test(id)) fail("bad_request", "自定义 provider 的 id 必须形如 custom-xxxx（小写字母、数字、连字符）");
        const baseUrl = cleanUrl(input.baseUrl, true);
        const modelIds = uniqueIds(input.modelIds);
        if (!input.name?.trim()) fail("bad_request", "请填写名称");
        if (!modelIds) fail("bad_request", "请至少填写一个模型 ID");
        cfg = { id, kind: input.kind, name: input.name.trim(), ...(baseUrl ? { baseUrl } : {}), enabled: input.enabled !== false, modelIds, createdAt: providers.get(id)?.createdAt ?? now() };
      }
      const prev = providers.get(cfg.id);
      if (prev && prev.kind !== cfg.kind) fail("conflict", `provider ${cfg.id} 已存在且类型不同`);

      if (key === "") apiKeys.delete(cfg.id);
      else if (key !== undefined) apiKeys.set(cfg.id, key);
      const saved: ModelProviderConfig = { ...cfg, hasApiKey: apiKeys.has(cfg.id) };
      providers.set(saved.id, saved);
      publishModels();
      return { provider: { ...saved } };
    },

    "model.providerDelete": (p) => {
      if (!providers.has(p.providerId)) fail("not_found", `provider ${String(p.providerId)} 不存在`);
      providers.delete(p.providerId);
      apiKeys.delete(p.providerId);
      // 指向它的默认模型与成员模型一并清掉，免得留下悬空引用
      const keep = (r?: ModelRef) => (r && r.provider !== p.providerId ? r : undefined);
      const s = model.modelSettings ?? {};
      const router = keep(s.router);
      const native = keep(s.native);
      const settings: ModelSettings = { ...(router ? { router } : {}), ...(native ? { native } : {}) };
      for (const b of Object.values(model.bots)) {
        if (b.model?.provider !== p.providerId) continue;
        const { model: _drop, ...rest } = b;
        commit({ kind: "bot.updated", bot: rest });
      }
      publishModels(settings);
      return { ok: true };
    },

    "model.list": (p) => {
      if (p?.providerId && !providers.has(p.providerId)) fail("not_found", `provider ${p.providerId} 不存在`);
      const targets = p?.providerId ? [p.providerId] : [...providers.values()].filter((c) => c.enabled).map((c) => c.id);
      return { models: targets.flatMap(modelsOf) };
    },

    "model.test": async (p) => {
      if (!isRef(p?.ref)) fail("bad_request", "ref 需要 provider 与 modelId");
      const { ref } = p;
      const wait = opts.testMs ?? 300 + Math.floor(Math.random() * 600);
      if (wait > 0) await new Promise<void>((resolve) => later(wait, resolve));
      const cfg = providers.get(ref.provider);
      if (!cfg) return { ok: false, error: `服务商 "${ref.provider}" 不存在，请先在设置里添加` };
      if (!cfg.enabled) return { ok: false, error: `服务商 "${cfg.name}" 已停用` };
      if (!modelsOf(cfg.id).some((m) => m.id === ref.modelId)) return { ok: false, error: `模型 "${ref.modelId}" 不在服务商 "${cfg.name}" 的模型列表中` };
      const key = apiKeys.get(cfg.id);
      const needsKey = cfg.kind === "builtin" && !KEYLESS_PROVIDERS.has(cfg.builtinId ?? cfg.id);
      if (needsKey && !key) return { ok: false, error: `服务商 "${cfg.name}" 还没有配置 API Key` };
      if (key === "bad") return { ok: false, error: `401 Unauthorized：API Key 无效或已过期（${cfg.name}）` };
      return { ok: true, latencyMs: wait, reply: "OK" };
    },

    "model.settingsSet": (p) => {
      const next: ModelSettings = {};
      for (const purpose of ["router", "native"] as const) {
        const ref = p?.settings?.[purpose];
        if (ref === undefined) continue;
        const checked = requireProvider(ref, purpose);
        const cfg = providers.get(checked.provider)!;
        if (!cfg.enabled) fail("bad_request", `服务商 "${cfg.name}" 已停用，请先启用`);
        if (!modelsOf(cfg.id).some((m) => m.id === checked.modelId)) fail("bad_request", `服务商 "${cfg.name}" 没有模型 "${checked.modelId}"`);
        next[purpose] = checked;
      }
      publishModels(next);
      return { settings: { ...next } };
    },

    "device.list": () => ({ devices: Object.values(model.devices) }),

    "device.pairCode": () => ({
      code: String(100_000 + Math.floor(Math.random() * 900_000)),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
  };

  initRuns();

  const emitStatus = (s: "connecting" | "open" | "closed") => statusHandlers.forEach((h) => h(s));

  return {
    async request(method, params) {
      if (disposed) throw new Error("not connected");
      const f = impl[method] as ((p: unknown) => unknown) | undefined;
      if (!f) fail("unsupported", `未知方法 ${method}`);
      return (await f(params)) as never;
    },
    onPush(h) {
      pushHandlers.add(h);
      return () => pushHandlers.delete(h);
    },
    onStatus(h) {
      statusHandlers.add(h);
      queueMicrotask(() => {
        if (!disposed && statusHandlers.has(h)) h("open");
      });
      return () => statusHandlers.delete(h);
    },
    close() {
      if (disposed) return;
      disposed = true;
      timers.forEach(clearTimeout);
      timers.clear();
      emitStatus("closed");
    },
    getModel: () => model,
  };
}

export { MAIN_THREAD_ID };
