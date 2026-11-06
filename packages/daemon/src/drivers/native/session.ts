// 一个 DriverSession = 一个 pi-durable conversation：send 映射 submit/abort，fork 映射 conversation.fork，事件来自 watch。
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  ConversationIdle,
  type Conversation,
  type EntryId,
  type EntryRecord,
  type InputSubmissionDraft,
  type ConversationWatch,
} from "@earendil-works/pi-durable";
import type { DriverCaps, DriverEvent, DriverSession, SendMode } from "../../core/contracts";
import type { ApprovalRequest } from "./extension";
import { AsyncQueue } from "./queue";
import { INPUT_KIND, startsTurn, ViewTranslator } from "./translate";

const context = BACKGROUND_CONTEXT;
const IDLE_WAIT_MS = 5000;
const PAGE = 500;

/** 没有任何可用模型时，这一轮给用户的提示。 */
export const NO_MODEL_TEXT = "我还没有可用的模型。请到 设置 → 模型 添加一个模型服务并设为默认，或在团队页给我单独指定模型。";

/** 会话需要的外部能力：选模型、派生子会话时复用，以及关闭时注销审批回调。 */
export interface SessionHost {
  /** 让会话用上当前应使用的模型（配置变了就切换）；返回 false 表示没有任何可用模型。 */
  ensureModel(conversation: Conversation): Promise<boolean>;
  /** 把审批回调挂到会话上；返回注销函数。 */
  registerApprover(conversationId: number, approver: (request: ApprovalRequest) => Promise<boolean>): () => void;
}

export class NativeSession implements DriverSession {
  readonly caps: DriverCaps = { steer: true, fork: true, interrupt: true, approvals: true };
  readonly nativeId: string;
  readonly events: AsyncIterable<DriverEvent>;

  readonly #conversation: Conversation;
  readonly #host: SessionHost;
  readonly #queue: AsyncQueue<DriverEvent>;
  readonly #translator: ViewTranslator;
  readonly #watch: ConversationWatch;
  readonly #unregister: () => void;
  readonly #pending = new Map<string, (allow: boolean) => void>();
  readonly #idleWaiters = new Set<() => void>();
  #approvalSeq = 0;
  #closed = false;

  private constructor(host: SessionHost, conversation: Conversation, watch: ConversationWatch, translator: ViewTranslator, queue: AsyncQueue<DriverEvent>) {
    this.#host = host;
    this.#conversation = conversation;
    this.#watch = watch;
    this.#translator = translator;
    this.#queue = queue;
    this.events = queue;
    this.nativeId = String(conversation.id);
    this.#unregister = host.registerApprover(conversation.id, (request) => this.#requestApproval(request));
  }

  /** 挂上 watch 并按已有历史初始化轮次计数（恢复时不重放旧事件）。 */
  static async attach(host: SessionHost, conversation: Conversation): Promise<NativeSession> {
    const watch = await conversation.watch(context);
    const initial = watch.value;
    const lastEntryId = initial.entries.at(-1)?.id ?? initial.before ?? 0;
    const history = lastEntryId === 0 ? [] : await loadEntries(conversation, lastEntryId);
    const translator = new ViewTranslator({ turn: history.filter(startsTurn).length, lastEntryId }, initial);
    const queue = new AsyncQueue<DriverEvent>();
    const session = new NativeSession(host, conversation, watch, translator, queue);
    watch.start(async (call) => {
      if (call.kind !== "value") return;
      for (const event of translator.update(call.value)) queue.push(event);
      if (!translator.active) session.#releaseIdleWaiters();
    });
    void watch.closed.then(() => {
      queue.end();
      session.#unregister();
    });
    return session;
  }

  async send(text: string, mode: SendMode): Promise<void> {
    // 每次发送前确认会话用的是当前该用的模型；没有可用模型时不提交，直接给出一轮“请先配置模型”的失败。
    if (!(await this.#host.ensureModel(this.#conversation)) && !this.#translator.active) {
      this.#failNoModel();
      return;
    }
    const input = (m: SendMode): InputSubmissionDraft => ({ type: "input", content: text, entry: { kind: INPUT_KIND, data: { mode: m } } });
    switch (mode) {
      case "steer":
        // 运行中才算插话；空闲时 whenIdle:"reject" 让我们改走普通提交，条目里也记成 normal。
        try {
          await this.#conversation.submit({ ...input("steer"), whenBusy: "steer", whenIdle: "reject" }, context);
        } catch (error) {
          if (!(error instanceof ConversationIdle)) throw error;
          await this.#conversation.submit(input("normal"), context);
        }
        return;
      case "interrupt":
        await this.interrupt();
        await this.#conversation.submit(input("interrupt"), context);
        return;
      default:
        await this.#conversation.submit(input(mode), context);
    }
  }

  async interrupt(): Promise<void> {
    this.#denyPending();
    const wasActive = this.#translator.active;
    await this.#conversation.abort(context);
    // 等 watch 把 turn_end(interrupted) 投递出来，保证它排在后续新一轮的 turn_start 之前。
    if (wasActive) await this.#waitInactive();
  }

  async resolveApproval(requestId: string, allow: boolean): Promise<void> {
    const resolve = this.#pending.get(requestId);
    this.#pending.delete(requestId);
    resolve?.(allow);
  }

  async fork(atTurn: number, opts?: { cwd?: string }): Promise<DriverSession> {
    const entries = await loadEntries(this.#conversation);
    const child = await this.#conversation.fork(turnEndEntry(entries, atTurn), {
      ownership: { kind: "ownerless" },
      ...(opts?.cwd ? { agent: { cwd: opts.cwd } } : {}),
    }, context);
    return NativeSession.attach(this.#host, child);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#denyPending();
    this.#unregister();
    // 不 abort 正在跑的轮：关闭会话只是停止观察，未完成的运行在下次打开存储时可继续。
    await this.#watch.stop();
    this.#queue.end();
    this.#releaseIdleWaiters();
  }

  /** 合成的一轮：不经过 pi-durable（没有条目），轮次号接着已有历史往下数。 */
  #failNoModel(): void {
    this.#translator.turn += 1;
    this.#queue.push({ t: "turn_start", turn: this.#translator.turn });
    this.#queue.push({ t: "text_delta", delta: NO_MODEL_TEXT });
    this.#queue.push({ t: "text_done" });
    this.#queue.push({ t: "turn_end", status: "failed", error: "no_model" });
  }

  #requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.#closed) return Promise.resolve(false);
    const requestId = `${this.nativeId}-approval-${++this.#approvalSeq}`;
    this.#queue.push({ t: "approval", requestId, ...request });
    return new Promise((resolve) => this.#pending.set(requestId, resolve));
  }

  #denyPending(): void {
    for (const resolve of this.#pending.values()) resolve(false);
    this.#pending.clear();
  }

  #waitInactive(): Promise<void> {
    if (!this.#translator.active) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#idleWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, IDLE_WAIT_MS);
      this.#idleWaiters.add(done);
    });
  }

  #releaseIdleWaiters(): void {
    for (const release of [...this.#idleWaiters]) release();
  }
}

/** 按 id 升序读完整个（含祖先的）历史；maxEntryId 限定上界。 */
async function loadEntries(conversation: Conversation, maxEntryId?: EntryId | number): Promise<EntryRecord[]> {
  const all: EntryRecord[] = [];
  let cursor;
  do {
    const page = await conversation.entries(
      { order: "ascending", ...(maxEntryId ? { maxEntryId: maxEntryId as EntryId } : {}) },
      PAGE,
      cursor,
      context,
    );
    all.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return all;
}

/** 第 atTurn 轮最后一个条目的 id：下一轮开始之前的那条；最后一轮取整段历史的末尾。 */
export function turnEndEntry(entries: readonly EntryRecord[], atTurn: number): EntryId {
  let turn = 0;
  for (const [i, entry] of entries.entries()) {
    if (!startsTurn(entry)) continue;
    turn += 1;
    if (turn === atTurn + 1) return entries[i - 1]!.id;
  }
  if (atTurn < 1 || atTurn > turn) throw new Error(`没有第 ${atTurn} 轮可分支（共 ${turn} 轮）`);
  return entries.at(-1)!.id;
}
