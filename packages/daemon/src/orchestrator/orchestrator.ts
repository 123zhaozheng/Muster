// OWNER: B5. Task lifecycle: sessions, steer/queue/interrupt, approvals, fork/branches, git worktrees.
import path from "node:path";
import type {
  Approval, ApprovalId, Bot, BotId, BotStatus, Branch, DiffFile, Entry, EntryId, Task, TaskId, Thread, ThreadId, ToolItem,
} from "@muster/protocol";
import type {
  DriverEvent, DriverRegistry, DriverSession, Handlers, Hub, Orchestrator, Router, SendMode, StartTaskArgs,
} from "../core/contracts";
import { errMsg, OrchestratorError } from "./errors";
import { createStore } from "./store";
import { copyDir, createWorktree, isInside, makeEmptyDir, removeWorktree, shortId } from "./workspace";

export interface OrchestratorOptions {
  hub: Hub;
  drivers: DriverRegistry;
  dataDir: string;
  getRouter: () => Router;
  /** 恢复单个会话的等待上限（毫秒），默认 20000。 */
  recoverTimeoutMs?: number;
}

type ToolSummaryEntry = Extract<Entry, { kind: "tool_summary" }>;
type SteerEntry = Extract<Entry, { kind: "steer" }>;

/** 单个任务的运行时状态（仅内存；原生会话 id 与 turn 边界另存 orchestrator.json）。 */
interface Runtime {
  taskId: TaskId;
  threadId: ThreadId;
  botId: BotId;
  session: DriverSession;
  unattended: boolean;
  /** 一轮正在进行，或已有排队消息即将开始新一轮。 */
  busy: boolean;
  /** 被主动关闭（取消/关机）：丢弃后续事件，不把任务标为失败。 */
  closing: boolean;
  turn: number;
  /** 当前 turn 内最后一个属于该 turn 的 entry（用于 fork 定位）。 */
  turnTail?: EntryId;
  /** turn 序号 -> 该 turn 的最后一个 entry id。 */
  turnEnds: Map<number, EntryId>;
  /** 等待“开启新一轮”的用户消息 entry（FIFO）；其长度即待处理轮数。 */
  queued: EntryId[];
  /** 已送入运行中 turn、等待 steer_applied 的插话。 */
  steers: { entryId: EntryId; text: string }[];
  text?: { id: EntryId };
  tools?: ToolSummaryEntry;
  /** approvalId -> 引擎侧 requestId。 */
  approvals: Map<ApprovalId, string>;
  resolving: Set<ApprovalId>;
  files: Set<string>;
  tests?: { passed: number; failed: number };
  lastText?: string;
  /** 估算进度（内部值，可能领先于已提交的 task.progress，见 bumpProgress 的节流）。 */
  progress: number;
  /** 上一次提交进度的时间（毫秒）。 */
  progressAt: number;
  pump?: Promise<void>;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const branchLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
const MAX_TOOL_ITEMS = 200;
/** 运行中进度：turn_start 10%，每个 tool/diff/tests 事件向 90% 逼近，turn_end completed 才到 100%。 */
const PROGRESS_START = 10;
const PROGRESS_CAP = 90;
/** 进度提交节流：距上次提交 ≥300ms，或累计变化 ≥5 个百分点。 */
const PROGRESS_MIN_MS = 300;
const PROGRESS_MIN_STEP = 5;
/** 新一轮开始时的进度：已满（100）或未知则从起点重来，否则保持不回退。 */
const restartProgress = (p: number | undefined): number => (p === undefined || p >= 100 ? PROGRESS_START : Math.max(p, PROGRESS_START));

export function createOrchestrator(o: OrchestratorOptions): Orchestrator {
  const { hub, drivers, dataDir } = o;
  const store = createStore(path.join(dataDir, "orchestrator.json"));
  const runtimes = new Map<TaskId, Runtime>();
  let shuttingDown = false;

  // ───────────────────────── hub helpers ─────────────────────────

  const getEntry = (threadId: ThreadId, id: EntryId): Entry | undefined => hub.model.entries[threadId]?.find((e) => e.id === id);

  function requireTask(taskId: TaskId): Task {
    const t = hub.model.tasks[taskId];
    if (!t) throw new OrchestratorError("not_found", `任务不存在：${taskId}`);
    return t;
  }

  function mutateTask(taskId: TaskId, patch: Partial<Task>): Task {
    const next = { ...requireTask(taskId), ...patch };
    hub.commit({ kind: "task.updated", task: next });
    return next;
  }

  function touchThread(threadId: ThreadId, lastText?: string): void {
    const th = hub.model.threads[threadId];
    if (!th) return;
    hub.commit({ kind: "thread.updated", thread: { ...th, updatedAt: hub.now(), ...(lastText !== undefined ? { lastText: clip(oneLine(lastText), 80) } : {}) } });
  }

  const base = (threadId: ThreadId) => ({ id: hub.newId("entry"), threadId, ts: hub.now() });

  function append(e: Entry, preview?: string): Entry {
    hub.commit({ kind: "entry.appended", entry: e });
    if (preview !== undefined) touchThread(e.threadId, preview);
    return e;
  }

  /** 属于某个 turn 的 entry：同时刷新 turn 末尾标记。 */
  function appendTurn(rt: Runtime, e: Entry, preview?: string): Entry {
    append(e, preview);
    rt.turnTail = e.id;
    return e;
  }

  function appendSystem(threadId: ThreadId, text: string): Entry {
    return append({ ...base(threadId), kind: "system", text }, text);
  }

  /** 按任务当前活动重新计算 bot 状态；没有活动任务时落到 rest。 */
  function refreshBot(botId: BotId, rest: { status: BotStatus; detail?: string }, patch?: Partial<Bot>): void {
    const bot = hub.model.bots[botId];
    if (!bot) return;
    let { status, detail } = rest;
    const mine = [...runtimes.values()].filter((r) => r.botId === botId);
    const waiting = mine.map((r) => hub.model.tasks[r.taskId]).find((t) => t?.status === "waiting_approval");
    const working = mine.map((r) => (r.busy ? hub.model.tasks[r.taskId] : undefined)).find((t) => t?.status === "running");
    if (waiting) ({ status, detail } = { status: "waiting_approval", detail: waiting.title });
    else if (working) ({ status, detail } = { status: "working", detail: working.title });
    if (!patch && bot.status === status && bot.statusDetail === detail) return;
    hub.commit({ kind: "bot.updated", bot: { ...bot, ...patch, status, statusDetail: detail } });
  }

  /** 任务状态变化时在事件中心留一条“回调”事件。 */
  function logEvent(
    task: Task, verb: string, extra: { detail?: string; status?: "recorded" | "dispatched" | "failed"; triggerId?: string } = {},
  ): void {
    const bot = hub.model.bots[task.botId];
    hub.commit({
      kind: "event.logged",
      event: {
        id: hub.newId("evt"), ts: hub.now(), source: "callback",
        title: `回调 · ${bot?.name ?? task.botId} ${verb} ${task.title}`,
        ...(extra.detail ? { detail: extra.detail } : {}),
        botId: task.botId, taskId: task.id, status: extra.status ?? "recorded",
        ...(extra.triggerId ? { triggerId: extra.triggerId } : {}),
      },
    });
  }

  function notifyRouter(task: Task, kind: "done" | "failed" | "waiting_approval"): void {
    try {
      void Promise.resolve(o.getRouter().onTaskEvent(task, kind)).catch((e) => console.warn("[orchestrator] router.onTaskEvent 失败:", errMsg(e)));
    } catch (e) {
      console.warn("[orchestrator] router 不可用:", errMsg(e));
    }
  }

  function persistRt(rt: Runtime): void {
    store.set(rt.taskId, { nativeId: rt.session.nativeId, turns: Object.fromEntries(rt.turnEnds) });
  }

  // ───────────────────────── branch helpers ─────────────────────────

  function rootOf(taskId: TaskId): TaskId {
    let cur = taskId;
    for (let i = 0; i < 1000; i++) {
      const from = hub.model.tasks[cur]?.forkedFrom;
      if (!from || !hub.model.tasks[from.taskId]) return cur;
      cur = from.taskId;
    }
    return cur;
  }

  const familyTasks = (taskId: TaskId): Task[] => {
    const root = rootOf(taskId);
    return Object.values(hub.model.tasks).filter((t) => rootOf(t.id) === root);
  };

  const familyBranches = (taskId: TaskId): Branch[] => {
    const ids = new Set(familyTasks(taskId).map((t) => t.id));
    return Object.values(hub.model.branches).filter((b) => ids.has(b.taskId));
  };

  /** 把运行时统计同步到该任务对应的 Branch 记录（若有）。 */
  function syncBranch(rt: Runtime): void {
    const b = Object.values(hub.model.branches).find((x) => x.taskId === rt.taskId);
    if (!b) return;
    const task = hub.model.tasks[rt.taskId];
    const next: Branch = {
      ...b,
      filesChanged: rt.files.size,
      ...(rt.tests ? { tests: rt.tests } : {}),
      ...(task?.tokens !== undefined ? { tokens: task.tokens } : {}),
      summary: rt.lastText ? clip(oneLine(rt.lastText), 120) : b.summary,
    };
    if (JSON.stringify(next) !== JSON.stringify(b)) hub.commit({ kind: "branch.updated", branch: next });
  }

  // ───────────────────────── progress ─────────────────────────

  /**
   * 按事件估算进度：每次向 PROGRESS_CAP 逼近剩余距离的 `weight` 比例（至少 +1），单调不减。
   * 等待审批期间保持不动；提交做节流，避免高频事件刷屏。
   */
  function bumpProgress(rt: Runtime, weight: number): void {
    const task = hub.model.tasks[rt.taskId];
    if (!task || task.status !== "running" || rt.progress >= PROGRESS_CAP) return;
    rt.progress = Math.min(PROGRESS_CAP, rt.progress + Math.max(1, Math.round((PROGRESS_CAP - rt.progress) * weight)));
    const committed = task.progress ?? 0;
    const now = Date.now();
    if (rt.progress > committed && (rt.progress - committed >= PROGRESS_MIN_STEP || now - rt.progressAt >= PROGRESS_MIN_MS)) {
      rt.progressAt = now;
      mutateTask(rt.taskId, { progress: rt.progress });
    }
  }

  // ───────────────────────── approvals ─────────────────────────

  /** “<bot名> 想<动作>”：动作取自驱动给出的结构化标题，去掉换行并限长。 */
  function approvalTitle(botName: string, raw: string): string {
    let action = oneLine(raw);
    if (action.startsWith(botName)) action = action.slice(botName.length).trim();
    if (action.startsWith("想")) action = action.slice(1).trim();
    return `${botName} 想${clip(action || "执行一项操作", 80)}`;
  }

  /** 使该任务所有待处理审批失效（会话中断/取消/重启后无法再回复引擎）。 */
  function expireApprovals(taskId: TaskId): void {
    for (const ap of Object.values(hub.model.approvals)) {
      if (ap.taskId === taskId && ap.status === "pending") {
        hub.commit({ kind: "approval.updated", approval: { ...ap, status: "expired", resolvedAt: hub.now() } });
      }
    }
    runtimes.get(taskId)?.approvals.clear();
  }

  function onApproval(rt: Runtime, ev: Extract<DriverEvent, { t: "approval" }>): void {
    const task = requireTask(rt.taskId);
    const bot = hub.model.bots[rt.botId];
    const title = approvalTitle(bot?.name ?? rt.botId, ev.title);
    const ts = hub.now();
    const approval: Approval = {
      id: hub.newId("appr"), botId: rt.botId, taskId: rt.taskId, title,
      ...(ev.detail ? { detail: clip(ev.detail, 4000) } : {}),
      risk: ev.risk, status: rt.unattended ? "denied" : "pending", createdAt: ts,
      ...(rt.unattended ? { resolvedAt: ts, unattended: true } : {}),
    };
    hub.commit({ kind: "approval.created", approval });
    appendTurn(rt, { ...base(rt.threadId), kind: "approval", approvalId: approval.id });

    if (rt.unattended) {
      appendSystem(rt.threadId, `无人值守任务，已自动拒绝：${title}`);
      logEvent(task, "的权限请求已自动拒绝", { detail: title });
      rt.session.resolveApproval(ev.requestId, false).catch((e) => appendSystem(rt.threadId, `自动拒绝回复失败：${errMsg(e)}`));
      return;
    }
    rt.approvals.set(approval.id, ev.requestId);
    const waiting = mutateTask(rt.taskId, { status: "waiting_approval" });
    refreshBot(rt.botId, { status: "waiting_approval", detail: waiting.title });
    logEvent(waiting, "需要你审批", { detail: title });
    notifyRouter(waiting, "waiting_approval");
  }

  // ───────────────────────── event translation ─────────────────────────

  function finalizeText(rt: Runtime): void {
    if (!rt.text) return;
    const cur = getEntry(rt.threadId, rt.text.id);
    if (cur?.kind === "bot") {
      hub.commit({ kind: "entry.replaced", entry: { ...cur, streaming: false } });
      rt.lastText = cur.text;
      touchThread(rt.threadId, cur.text);
    }
    rt.text = undefined;
  }

  /** 非 tool 事件到来：结束当前文本与工具聚合。 */
  function closeOpen(rt: Runtime): void {
    finalizeText(rt);
    rt.tools = undefined;
  }

  function markApplied(threadId: ThreadId, entryId: EntryId): void {
    const e = getEntry(threadId, entryId);
    if (e?.kind === "steer" && e.applied !== "applied") hub.commit({ kind: "entry.replaced", entry: { ...e, applied: "applied" } });
  }

  function onTool(rt: Runtime, ev: Extract<DriverEvent, { t: "tool" }>): void {
    finalizeText(rt);
    const item: ToolItem = {
      tool: ev.tool, label: ev.label,
      ...(ev.output !== undefined ? { output: clip(ev.output, 2000) } : {}),
      ...(ev.ok !== undefined ? { ok: ev.ok } : {}),
    };
    const prev = rt.tools;
    const next: ToolSummaryEntry = prev
      ? { ...prev, items: prev.items.length < MAX_TOOL_ITEMS ? [...prev.items, item] : prev.items }
      : { ...base(rt.threadId), kind: "tool_summary", botId: rt.botId, reads: 0, commands: 0, edits: 0, items: [item] };
    if (ev.kind === "read") next.reads += 1;
    else if (ev.kind === "command") next.commands += 1;
    else if (ev.kind === "edit") next.edits += 1;
    rt.tools = next;
    if (prev) hub.commit({ kind: "entry.replaced", entry: next });
    else appendTurn(rt, next);
    bumpProgress(rt, 0.08);
  }

  function onTurnEnd(rt: Runtime, ev: Extract<DriverEvent, { t: "turn_end" }>): void {
    closeOpen(rt);
    const tail = rt.turnTail ?? hub.model.entries[rt.threadId]?.at(-1)?.id;
    if (tail) rt.turnEnds.set(rt.turn, tail);
    rt.busy = rt.queued.length > 0;
    expireApprovals(rt.taskId);

    const cur = requireTask(rt.taskId);
    const usage: Partial<Task> = {};
    if (ev.usage?.tokens !== undefined) usage.tokens = (cur.tokens ?? 0) + ev.usage.tokens;
    if (ev.usage?.costUsd !== undefined) usage.costUsd = (cur.costUsd ?? 0) + ev.usage.costUsd;
    const bot = hub.model.bots[rt.botId];
    const costPatch = ev.usage?.costUsd !== undefined && bot ? { costWeekUsd: bot.costWeekUsd + ev.usage.costUsd } : undefined;
    const more = rt.queued.length > 0;

    if (ev.status === "failed") {
      rt.queued = [];
      rt.steers = [];
      rt.busy = false;
      mutateTask(rt.taskId, usage);
      if (costPatch) refreshBot(rt.botId, { status: bot?.status ?? "idle", detail: bot?.statusDetail }, costPatch);
      failTask(rt.taskId, `任务失败：${ev.error ?? "未知错误"}`, ev.error);
    } else if (ev.status === "interrupted") {
      mutateTask(rt.taskId, { ...usage, status: "running", finishedAt: undefined });
      appendSystem(rt.threadId, "已打断当前步骤");
      refreshBot(rt.botId, { status: "idle", detail: "已中断" }, costPatch);
      logEvent(requireTask(rt.taskId), "被打断了");
    } else if (more) {
      mutateTask(rt.taskId, { ...usage, status: "running" });
      refreshBot(rt.botId, { status: "working", detail: cur.title }, costPatch);
    } else {
      const task = mutateTask(rt.taskId, { ...usage, status: "done", progress: 100, finishedAt: hub.now() });
      refreshBot(rt.botId, { status: "done", detail: task.title }, costPatch);
      logEvent(task, "完成了");
      notifyRouter(task, "done");
    }
    syncBranch(rt);
    persistRt(rt);
  }

  function handleEvent(rt: Runtime, ev: DriverEvent): void {
    switch (ev.t) {
      case "turn_start": {
        rt.turn = ev.turn;
        rt.busy = true;
        closeOpen(rt);
        const queuedId = rt.queued.shift();
        if (queuedId) {
          rt.turnTail = queuedId;
          markApplied(rt.threadId, queuedId);
        }
        const task = requireTask(rt.taskId);
        rt.progress = restartProgress(task.progress);
        rt.progressAt = Date.now();
        const live = task.status === "running" || task.status === "waiting_approval";
        const active =
          live && task.progress === rt.progress ? task
          : mutateTask(rt.taskId, { progress: rt.progress, ...(live ? {} : { status: "running" as const, finishedAt: undefined }) });
        refreshBot(rt.botId, { status: "working", detail: active.title });
        return;
      }
      case "text_delta": {
        if (!ev.delta) return;
        rt.tools = undefined;
        if (rt.text) {
          hub.commit({ kind: "entry.delta", threadId: rt.threadId, entryId: rt.text.id, delta: ev.delta });
        } else {
          const e = appendTurn(rt, { ...base(rt.threadId), kind: "bot", botId: rt.botId, text: ev.delta, streaming: true });
          rt.text = { id: e.id };
        }
        return;
      }
      case "text_done":
        finalizeText(rt);
        return;
      case "tool":
        onTool(rt, ev);
        return;
      case "diff": {
        closeOpen(rt);
        appendTurn(rt, { ...base(rt.threadId), kind: "diff", botId: rt.botId, files: ev.files });
        for (const f of ev.files as DiffFile[]) rt.files.add(f.path);
        syncBranch(rt);
        bumpProgress(rt, 0.15);
        return;
      }
      case "tests":
        closeOpen(rt);
        appendTurn(rt, { ...base(rt.threadId), kind: "test_result", botId: rt.botId, passed: ev.passed, failed: ev.failed });
        rt.tests = { passed: ev.passed, failed: ev.failed };
        syncBranch(rt);
        bumpProgress(rt, 0.15);
        return;
      case "approval":
        closeOpen(rt);
        onApproval(rt, ev);
        return;
      case "steer_applied": {
        const i = rt.steers.findIndex((s) => s.text.trim() === ev.text.trim());
        const [hit] = rt.steers.splice(i >= 0 ? i : 0, 1);
        if (hit) markApplied(rt.threadId, hit.entryId);
        return;
      }
      case "turn_end":
        onTurnEnd(rt, ev);
        return;
    }
  }

  // ───────────────────────── failure ─────────────────────────

  function failTask(taskId: TaskId, systemText: string, detail?: string): void {
    const cur = hub.model.tasks[taskId];
    if (!cur || cur.status === "cancelled") return;
    const rt = runtimes.get(taskId);
    if (rt) {
      rt.queued = [];
      rt.steers = [];
      rt.busy = false;
      closeOpen(rt);
    }
    expireApprovals(taskId);
    const task = mutateTask(taskId, { status: "failed", finishedAt: hub.now() });
    appendSystem(task.threadId, systemText);
    refreshBot(task.botId, { status: "error", detail: clip(oneLine(systemText), 60) });
    logEvent(task, "失败了", { status: "failed", detail: detail ?? systemText });
    notifyRouter(task, "failed");
  }

  // ───────────────────────── session plumbing ─────────────────────────

  function attach(task: Task, session: DriverSession, init: Partial<Runtime> = {}): Runtime {
    const rt: Runtime = {
      taskId: task.id, threadId: task.threadId, botId: task.botId, session, unattended: false, busy: false, closing: false,
      turn: 0, turnEnds: new Map(), queued: [], steers: [], approvals: new Map(), resolving: new Set(), files: new Set(),
      progress: task.progress ?? 0, progressAt: 0,
      ...init,
    };
    runtimes.set(task.id, rt);
    persistRt(rt);
    rt.pump = (async () => {
      let streamError: unknown;
      try {
        for await (const ev of session.events) {
          if (rt.closing) continue;
          try {
            handleEvent(rt, ev);
          } catch (e) {
            console.error(`[orchestrator] 处理事件 ${ev.t} 失败:`, e);
          }
        }
      } catch (e) {
        streamError = e;
      }
      onSessionEnded(rt, streamError);
    })();
    return rt;
  }

  function onSessionEnded(rt: Runtime, error: unknown): void {
    if (runtimes.get(rt.taskId) === rt) runtimes.delete(rt.taskId);
    if (rt.closing || shuttingDown) return;
    const task = hub.model.tasks[rt.taskId];
    if (!task || (task.status !== "running" && task.status !== "waiting_approval")) return;
    failTask(rt.taskId, error ? `会话异常结束：${errMsg(error)}` : "会话意外结束");
  }

  function requireRuntime(taskId: TaskId): Runtime {
    requireTask(taskId);
    const rt = runtimes.get(taskId);
    if (!rt) throw new OrchestratorError("conflict", "该任务的会话当前未在运行");
    return rt;
  }

  // ───────────────────────── startTask ─────────────────────────

  async function startTask(a: StartTaskArgs): Promise<Task> {
    const bot = hub.model.bots[a.botId];
    if (!bot) throw new OrchestratorError("not_found", `Bot 不存在：${a.botId}`);
    if (bot.kind === "main") throw new OrchestratorError("bad_request", "主 Bot 不能执行任务");
    const driver = drivers.get(bot.kind);
    if (!driver) throw new OrchestratorError("unsupported", `没有可用的 ${bot.engineLabel} 驱动`);

    const taskId = hub.newId("task");
    const threadId = hub.newId("thread");
    const notes: string[] = [];
    let cwd: string;
    let branch: string | undefined;
    let wt: { fromDir: string; path: string; branch: string } | undefined;

    if (a.cwd) {
      cwd = a.cwd;
      const wtPath = path.join(dataDir, "worktrees", taskId);
      const wtBranch = `muster/${shortId(taskId)}`;
      await createWorktree(a.cwd, wtPath, wtBranch).then(
        (w) => {
          cwd = w.cwd;
          branch = w.branch;
          wt = { fromDir: a.cwd!, path: wtPath, branch: wtBranch };
        },
        (e: unknown) => {
          if (!/not a git repository/i.test(errMsg(e))) notes.push(`无法创建 git 工作树（${clip(oneLine(errMsg(e)), 120)}），直接使用原目录`);
        },
      );
    } else {
      cwd = await makeEmptyDir(path.join(dataDir, "workspaces", taskId));
    }

    let session: DriverSession;
    try {
      session = await driver.start({ cwd, prompt: a.prompt, bot });
    } catch (e) {
      if (wt) await removeWorktree(wt.fromDir, wt.path, wt.branch);
      throw new OrchestratorError("internal", `启动 ${bot.name} 失败：${errMsg(e)}`);
    }

    const now = hub.now();
    const thread: Thread = { id: threadId, title: a.title, botId: bot.id, taskId, createdAt: now, updatedAt: now, lastText: clip(oneLine(a.prompt), 80) };
    hub.commit({ kind: "thread.updated", thread });
    const task: Task = {
      id: taskId, title: a.title, botId: bot.id, threadId, parentThreadId: a.parentThreadId, status: "running", cwd,
      ...(branch ? { branch } : {}), startedAt: now,
    };
    hub.commit({ kind: "task.updated", task });
    // 创建 worktree / 启动驱动期间 bot 可能被编辑，以最新快照为准。
    const fresh = hub.model.bots[bot.id] ?? bot;
    hub.commit({ kind: "bot.updated", bot: { ...fresh, status: "working", statusDetail: a.title, threadId } });
    const promptEntry = append({ ...base(threadId), kind: "user", text: a.prompt });
    for (const n of notes) appendSystem(threadId, n);
    logEvent(task, "开始了", { status: "dispatched", ...(a.triggerId ? { triggerId: a.triggerId } : {}) });

    attach(task, session, { unattended: !!a.unattended, busy: true, queued: [promptEntry.id] });
    return hub.model.tasks[taskId] ?? task;
  }

  // ───────────────────────── sendToThread ─────────────────────────

  async function sendToThread(threadId: ThreadId, text: string, mode: SendMode): Promise<EntryId> {
    const task = Object.values(hub.model.tasks).find((t) => t.threadId === threadId);
    if (!task) throw new OrchestratorError("not_found", "该会话没有对应的任务");
    if (task.status === "cancelled") throw new OrchestratorError("conflict", "任务已取消");
    const rt = runtimes.get(task.id);
    if (!rt) throw new OrchestratorError("conflict", "该任务的会话当前未在运行（守护进程重启后未能恢复）");

    const wasBusy = rt.busy;
    let eff: SendMode = mode;
    let note: string | undefined;
    if (!wasBusy) {
      eff = "normal"; // 空闲时插话/排队/打断都等同于直接发送
    } else if (mode === "steer" && !rt.session.caps.steer) {
      eff = "queue";
      note = "当前引擎不支持插话，已改为排队，下一轮处理";
    } else if (mode === "interrupt" && !rt.session.caps.interrupt) {
      eff = "queue";
      note = "当前引擎不支持打断，已改为排队，下一轮处理";
    }

    let flipped = false;
    let entry: Entry;
    if (eff === "normal") {
      entry = { ...base(threadId), kind: "user", text };
    } else {
      const mode2: SteerEntry["mode"] = eff;
      entry = { ...base(threadId), kind: "steer", text, mode: mode2, applied: eff === "steer" ? "next_step" : "pending" };
    }
    append(entry, text);
    if (note) appendSystem(threadId, note);

    if (eff === "steer") {
      rt.steers.push({ entryId: entry.id, text });
      rt.turnTail = entry.id;
    } else {
      rt.queued.push(entry.id);
      rt.busy = true;
      // 已结束的任务收到新消息：立即回到运行中，不等引擎的 turn_start
      if (task.status === "done" || task.status === "failed") {
        rt.progress = restartProgress(task.progress);
        rt.progressAt = Date.now();
        const resumed = mutateTask(task.id, { status: "running", finishedAt: undefined, progress: rt.progress });
        refreshBot(rt.botId, { status: "working", detail: resumed.title });
        flipped = true;
      }
    }
    try {
      await rt.session.send(text, eff);
    } catch (e) {
      rt.steers = rt.steers.filter((s) => s.entryId !== entry.id);
      rt.queued = rt.queued.filter((id) => id !== entry.id);
      rt.busy = wasBusy;
      if (flipped) {
        hub.commit({ kind: "task.updated", task });
        refreshBot(rt.botId, { status: task.status === "failed" ? "error" : "done", detail: task.title });
      }
      appendSystem(threadId, `发送失败：${errMsg(e)}`);
      throw new OrchestratorError("internal", `发送失败：${errMsg(e)}`);
    }
    return entry.id;
  }

  // ───────────────────────── fork ─────────────────────────

  async function forkTask(p: { taskId: TaskId; entryId: EntryId; label?: string; botId?: BotId }): Promise<{ task: Task; branch: Branch }> {
    const src = requireTask(p.taskId);
    const rt = requireRuntime(p.taskId);
    if (!rt.session.caps.fork) throw new OrchestratorError("unsupported", "当前引擎不支持从某一步分支");
    const srcBot = hub.model.bots[src.botId];
    const bot = p.botId ? hub.model.bots[p.botId] : srcBot;
    if (!bot) throw new OrchestratorError("not_found", `Bot 不存在：${p.botId}`);
    if (bot.kind !== srcBot?.kind) throw new OrchestratorError("unsupported", "分支只能交给同一引擎类型的 Bot");

    const entries = hub.model.entries[src.threadId] ?? [];
    const idx = entries.findIndex((e) => e.id === p.entryId);
    if (idx < 0) throw new OrchestratorError("not_found", `步骤不存在：${p.entryId}`);
    let turn: number | undefined;
    let tailIdx = -1;
    for (const [n, endId] of [...rt.turnEnds].sort((x, y) => x[0] - y[0])) {
      const i = entries.findIndex((e) => e.id === endId);
      if (i >= idx) {
        turn = n;
        tailIdx = i;
        break;
      }
    }
    if (turn === undefined) throw new OrchestratorError("conflict", "该步骤所在的轮次尚未结束，暂时无法分支");

    // 新工作目录：优先 git worktree（基于原目录当前 HEAD）；临时工作区则复制；否则与原任务共用。
    const newTaskId = hub.newId("task");
    const newThreadId = hub.newId("thread");
    const srcCwd = src.cwd ?? dataDir;
    let cwd = srcCwd;
    let branch: string | undefined;
    let wt: { path: string; branch: string } | undefined;
    const notes: string[] = [];
    const wtPath = path.join(dataDir, "worktrees", newTaskId);
    const wtBranch = `muster/${shortId(newTaskId)}`;
    try {
      const w = await createWorktree(srcCwd, wtPath, wtBranch);
      cwd = w.cwd;
      branch = w.branch;
      wt = { path: wtPath, branch: wtBranch };
    } catch (e) {
      if (isInside(path.join(dataDir, "workspaces"), srcCwd)) {
        cwd = path.join(dataDir, "workspaces", newTaskId);
        await copyDir(srcCwd, cwd);
      } else {
        notes.push(`未能创建独立工作树（${clip(oneLine(errMsg(e)), 120)}），与原任务共用目录`);
      }
    }

    let session: DriverSession;
    try {
      session = await rt.session.fork(turn, { cwd });
    } catch (e) {
      if (wt) await removeWorktree(srcCwd, wt.path, wt.branch);
      throw new OrchestratorError("internal", `分支失败：${errMsg(e)}`);
    }

    const now = hub.now();
    const forkCount = familyTasks(src.id).filter((t) => t.forkedFrom).length;
    const label = p.label?.trim() || `分支 ${branchLetter(forkCount)}`;
    const title = `${src.title}（${label}）`;

    // 历史：复制 [0..tail]，id 重新生成；turn 边界映射到新 id。
    const idMap = new Map<EntryId, EntryId>();
    const history: Entry[] = entries.slice(0, tailIdx + 1).map((e) => {
      const id = hub.newId("entry");
      idMap.set(e.id, id);
      const copy = structuredClone(e) as Entry;
      return copy.kind === "bot" ? { ...copy, id, threadId: newThreadId, streaming: false } : { ...copy, id, threadId: newThreadId };
    });

    hub.commit({ kind: "thread.updated", thread: { id: newThreadId, title, botId: bot.id, taskId: newTaskId, createdAt: now, updatedAt: now, lastText: `从「${src.title}」分支` } });
    const task: Task = {
      id: newTaskId, title, botId: bot.id, threadId: newThreadId, parentThreadId: src.parentThreadId, status: "running", cwd,
      ...(branch ? { branch } : {}), forkedFrom: { taskId: src.id, entryId: p.entryId }, startedAt: now,
    };
    hub.commit({ kind: "task.updated", task });
    for (const e of history) hub.commit({ kind: "entry.appended", entry: e });
    appendSystem(newThreadId, `已从「${src.title}」的此步骤分支出新任务（${label}）`);
    for (const n of notes) appendSystem(newThreadId, n);

    if (!Object.values(hub.model.branches).some((b) => b.taskId === src.id)) {
      hub.commit({
        kind: "branch.updated",
        branch: {
          id: hub.newId("branch"), taskId: src.id, forkEntryId: p.entryId, label: "原始路线", botId: src.botId,
          summary: clip(oneLine(rt.lastText ?? src.title), 120), filesChanged: rt.files.size,
          ...(rt.tests ? { tests: rt.tests } : {}), ...(src.tokens !== undefined ? { tokens: src.tokens } : {}),
        },
      });
    }
    const newBranch: Branch = {
      id: hub.newId("branch"), taskId: newTaskId, forkEntryId: p.entryId, label, botId: bot.id,
      summary: `从「${src.title}」的此步骤分支`, filesChanged: 0,
    };
    hub.commit({ kind: "branch.updated", branch: newBranch });
    logEvent(task, "已分支出", { detail: `来源：${src.title}` });

    const turnEnds = new Map<number, EntryId>();
    for (const [n, endId] of rt.turnEnds) {
      const mapped = idMap.get(endId);
      if (n <= turn && mapped) turnEnds.set(n, mapped);
    }
    const tail = history.at(-1)?.id;
    attach(task, session, { turn, turnEnds, ...(tail ? { turnTail: tail } : {}) });
    return { task: hub.model.tasks[newTaskId] ?? task, branch: hub.model.branches[newBranch.id] ?? newBranch };
  }

  // ───────────────────────── handlers ─────────────────────────

  const handlers: Handlers = {
    "task.interrupt": async ({ taskId }) => {
      const rt = requireRuntime(taskId);
      if (!rt.session.caps.interrupt) throw new OrchestratorError("unsupported", "当前引擎不支持打断");
      await rt.session.interrupt();
      return { ok: true };
    },

    "task.cancel": async ({ taskId }) => {
      const task = requireTask(taskId);
      if (task.status === "cancelled") return { ok: true };
      if (task.status === "done" || task.status === "failed") throw new OrchestratorError("conflict", "任务已结束，无法取消");
      const rt = runtimes.get(taskId);
      if (rt) {
        rt.closing = true;
        runtimes.delete(taskId);
      }
      expireApprovals(taskId);
      const next = mutateTask(taskId, { status: "cancelled", finishedAt: hub.now() });
      if (rt) {
        await rt.session.interrupt().catch(() => {});
        await rt.session.close().catch((e) => console.warn("[orchestrator] 关闭会话失败:", errMsg(e)));
      }
      appendSystem(next.threadId, "任务已取消");
      refreshBot(next.botId, { status: "idle" });
      logEvent(next, "已取消");
      return { ok: true };
    },

    "task.fork": forkTask,

    "task.branches": async ({ taskId }) => {
      requireTask(taskId);
      return { branches: familyBranches(taskId) };
    },

    "branch.adopt": async ({ branchId }) => {
      const target = hub.model.branches[branchId];
      if (!target) throw new OrchestratorError("not_found", `分支不存在：${branchId}`);
      let adopted = target;
      for (const b of familyBranches(target.taskId)) {
        const want = b.id === branchId;
        if (b.adopted === want) {
          if (want) adopted = b;
          continue;
        }
        const next = { ...b, adopted: want };
        hub.commit({ kind: "branch.updated", branch: next });
        if (want) adopted = next;
      }
      const task = hub.model.tasks[target.taskId];
      hub.commit({
        kind: "event.logged",
        event: { id: hub.newId("evt"), ts: hub.now(), source: "user", title: `你采纳了 ${target.label}`, ...(task ? { detail: task.title, taskId: task.id } : {}), botId: target.botId, status: "recorded" },
      });
      return { branch: adopted };
    },

    "approval.resolve": async ({ approvalId, decision }) => {
      const ap = hub.model.approvals[approvalId];
      if (!ap) throw new OrchestratorError("not_found", `审批不存在：${approvalId}`);
      if (ap.status !== "pending") throw new OrchestratorError("conflict", "该审批已处理");
      const rt = ap.taskId ? runtimes.get(ap.taskId) : undefined;
      const requestId = rt?.approvals.get(approvalId);
      if (!rt || requestId === undefined) {
        hub.commit({ kind: "approval.updated", approval: { ...ap, status: "expired", resolvedAt: hub.now() } });
        throw new OrchestratorError("conflict", "该审批已失效（会话已结束或已重启）");
      }
      if (rt.resolving.has(approvalId)) throw new OrchestratorError("conflict", "该审批正在处理");
      const allow = decision === "allow";
      rt.resolving.add(approvalId);
      try {
        await rt.session.resolveApproval(requestId, allow);
      } catch (e) {
        throw new OrchestratorError("internal", `回复引擎失败：${errMsg(e)}`);
      } finally {
        rt.resolving.delete(approvalId);
      }
      rt.approvals.delete(approvalId);
      const approval: Approval = { ...ap, status: allow ? "allowed" : "denied", resolvedAt: hub.now() };
      hub.commit({ kind: "approval.updated", approval });
      const task = hub.model.tasks[rt.taskId];
      if (task && task.status === "waiting_approval" && rt.approvals.size === 0) {
        const resumed = mutateTask(rt.taskId, { status: "running" });
        refreshBot(rt.botId, { status: "working", detail: resumed.title });
        logEvent(resumed, allow ? "获得允许，继续运行" : "被拒绝后继续运行", { detail: ap.title });
      }
      return { approval };
    },
  };

  // ───────────────────────── recover / shutdown ─────────────────────────

  async function recoverOne(task: Task): Promise<void> {
    const interrupted = "守护进程重启，任务已中断";
    const bot = hub.model.bots[task.botId];
    const driver = bot && bot.kind !== "main" ? drivers.get(bot.kind) : undefined;
    const saved = store.get(task.id);
    if (!bot || !driver || !saved) {
      failTask(task.id, interrupted);
      return;
    }
    const limit = o.recoverTimeoutMs ?? 20_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const starting = driver.start({ cwd: task.cwd ?? path.join(dataDir, "workspaces", task.id), prompt: "", resumeNativeId: saved.nativeId, bot });
    try {
      const session = await Promise.race([
        starting,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error("恢复超时"));
          }, limit);
        }),
      ]);
      const turnEnds = new Map<number, EntryId>(Object.entries(saved.turns).map(([n, id]) => [Number(n), id]));
      expireApprovals(task.id);
      const resumed = mutateTask(task.id, { status: "running" });
      attach(resumed, session, { turnEnds, turn: Math.max(0, ...turnEnds.keys()) });
      appendSystem(task.threadId, "守护进程已重启，会话已恢复（上一轮可能被中断）");
      refreshBot(task.botId, { status: "idle", detail: "已恢复" });
      logEvent(resumed, "已恢复");
    } catch (e) {
      if (timedOut) starting.then((s) => s.close()).catch(() => {});
      failTask(task.id, interrupted, `恢复失败：${errMsg(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function recover(): Promise<void> {
    await store.load();
    const active = Object.values(hub.model.tasks).filter((t) => (t.status === "running" || t.status === "waiting_approval") && !runtimes.has(t.id));
    for (const task of active) {
      try {
        await recoverOne(task);
      } catch (e) {
        console.error(`[orchestrator] 恢复任务 ${task.id} 出错:`, e);
      }
    }
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    const all = [...runtimes.values()];
    for (const rt of all) rt.closing = true;
    await Promise.allSettled(all.map((rt) => rt.session.close()));
    await Promise.race([Promise.allSettled(all.map((rt) => rt.pump)), new Promise((r) => setTimeout(r, 3000).unref())]);
    runtimes.clear();
    await store.flush();
  }

  return { startTask, sendToThread, handlers, recover, shutdown };
}
