// OWNER: B3. `codex app-server` (JSON-RPC over stdio) driver.
//
// One app-server child process per DriverSession (simple isolation; fork spawns a sibling process and
// uses `thread/fork`, which loads the parent's rollout from disk).
//
// Mapping (Codex -> DriverEvent):
//   turn/started                      -> turn_start (1-based counter, ids remembered for fork)
//   item/agentMessage/delta           -> text_delta;  item/completed(agentMessage) -> text_done
//   item/reasoning/summaryTextDelta   -> thinking_delta (raw item/reasoning/textDelta when no summary);
//                                        item/completed(reasoning) -> thinking_done (full text if nothing streamed)
//   item/completed(commandExecution)  -> tool(command | read when every parsed action is a read)
//   item/completed(fileChange)        -> tool(edit) + diff
//   item/{commandExecution,fileChange}/requestApproval (server request) -> approval; resolveApproval -> accept|decline
//   turn/completed                    -> turn_end (tokens = thread total delta over the turn)
// Capabilities: steer (turn/steer, falls back to queue on mismatch), interrupt (turn/interrupt),
// fork at an exact turn (thread/fork lastTurnId), resume (thread/resume).
import type { DetectedAgent } from "@muster/protocol";
import type {
  AgentDriver, DriverCaps, DriverEvent, DriverSession, SendMode, StartSessionOpts,
} from "../../core/contracts";
import { commandRisk, itemToEvents, toDiffFiles, truncate } from "./map";
import { AsyncQueue } from "./queue";
import { RpcConnection, runVersion, type RpcId, type RpcNotification, type RpcServerRequest } from "./rpc";

export interface CodexDriverOptions {
  /** Executable to run (default "codex"). */
  command?: string;
  /** Full argument list replacing the default ["app-server"] (used by tests with a fake server). */
  args?: string[];
  /** Codex approval policy for threads we open. Default "on-request" so approvals reach the user. */
  approvalPolicy?: string;
  /** Codex sandbox mode for threads we open. Default "workspace-write". */
  sandbox?: string;
  requestTimeoutMs?: number;
}

const CAPS: DriverCaps = { steer: true, fork: true, interrupt: true, approvals: true };

interface Resolved {
  command: string;
  args: string[];
  approvalPolicy: string;
  sandbox: string;
  requestTimeoutMs?: number;
}

function textInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

class CodexSession implements DriverSession {
  readonly caps = CAPS;
  readonly events = new AsyncQueue<DriverEvent>();
  nativeId = "";

  private conn!: RpcConnection;
  private turnIds: string[] = []; // turnIds[n-1] = Codex turn id of user turn n
  private turnNo = 0;
  private busy = false;
  private activeTurnId: string | null = null;
  private queued: string[] = [];
  private closed = false;
  private tokenTotal = 0;
  private tokenBaseline = 0;
  private lastError: string | undefined;
  private readonly approvals = new Map<string, { rpcId: RpcId; method: string }>();
  private readonly fileChanges = new Map<string, any[]>();
  private readonly streamed = new Set<string>();
  /** 正在流式输出的推理块：itemId -> 采用的那一路（摘要 / 原文）与当前段号。 */
  private readonly reasoning = new Map<string, { via: "summary" | "raw"; index: number }>();

  constructor(private readonly o: Resolved) {}

  /** Spawn the process and run the initialize handshake. */
  async connect(): Promise<void> {
    this.conn = new RpcConnection(
      { command: this.o.command, args: this.o.args, requestTimeoutMs: this.o.requestTimeoutMs },
      {
        onNotification: (n) => this.onNotification(n),
        onServerRequest: (r) => this.onServerRequest(r),
        onExit: (info) => this.onExit(info),
      },
    );
    try {
      await this.conn.request("initialize", {
        clientInfo: { name: "muster", title: "Muster", version: "0.0.1" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      this.conn.notify("initialized");
    } catch (e) {
      this.dispose();
      throw new Error(`无法连接 codex app-server：${errMsg(e)}`);
    }
  }

  private threadOverrides(cwd?: string, model?: string) {
    return { cwd, model, approvalPolicy: this.o.approvalPolicy, sandbox: this.o.sandbox };
  }

  async openNew(cwd: string, model?: string): Promise<void> {
    const res = await this.conn.request("thread/start", this.threadOverrides(cwd, model));
    this.nativeId = res.thread.id;
  }

  async openResume(threadId: string, cwd: string, model?: string): Promise<void> {
    const res = await this.conn.request("thread/resume", { threadId, ...this.threadOverrides(cwd, model) });
    this.nativeId = res.thread.id;
    this.turnIds = Array.isArray(res.thread.turns) ? res.thread.turns.map((t: any) => String(t.id)) : [];
    this.turnNo = this.turnIds.length;
  }

  async openFork(parentId: string, lastTurnId: string, keep: string[], cwd?: string): Promise<void> {
    const res = await this.conn.request("thread/fork", { threadId: parentId, lastTurnId, ...this.threadOverrides(cwd) });
    this.nativeId = res.thread.id;
    const forked: string[] = Array.isArray(res.thread.turns) ? res.thread.turns.map((t: any) => String(t.id)) : [];
    this.turnIds = forked.length === keep.length ? forked : keep;
    this.turnNo = this.turnIds.length;
  }

  // ───────────── DriverSession ─────────────

  async send(text: string, mode: SendMode): Promise<void> {
    if (this.closed) throw new Error("会话已关闭");
    if (!this.busy) return this.startTurn(text);
    switch (mode) {
      case "steer": {
        if (!this.activeTurnId) { this.queued.push(text); return; }
        try {
          await this.conn.request(
            "turn/steer",
            { threadId: this.nativeId, input: textInput(text), expectedTurnId: this.activeTurnId },
            () => this.events.push({ t: "steer_applied", text }),
          );
        } catch {
          // Turn id mismatch / turn not steerable / turn just ended: degrade to queue.
          if (this.busy) this.queued.push(text);
          else await this.startTurn(text);
        }
        return;
      }
      case "interrupt":
        this.queued.push(text);
        await this.interrupt();
        return;
      default: // "normal" | "queue" while a turn is running
        this.queued.push(text);
    }
  }

  async interrupt(): Promise<void> {
    if (this.closed || !this.busy || !this.activeTurnId) return;
    await this.conn.request("turn/interrupt", { threadId: this.nativeId, turnId: this.activeTurnId });
  }

  async resolveApproval(requestId: string, allow: boolean): Promise<void> {
    const p = this.approvals.get(requestId);
    if (!p) return;
    this.approvals.delete(requestId);
    this.conn.respond(p.rpcId, { decision: allow ? "accept" : "decline" });
  }

  async fork(atTurn: number, opts?: { cwd?: string }): Promise<DriverSession> {
    if (!Number.isInteger(atTurn) || atTurn < 1) throw new Error(`无效的分支位置：${atTurn}`);
    if (this.turnIds.length < atTurn) await this.loadTurnIds();
    const lastTurnId = this.turnIds[atTurn - 1];
    if (!lastTurnId) throw new Error(`第 ${atTurn} 轮不存在，无法分支`);
    const child = new CodexSession(this.o);
    await child.connect();
    try {
      await child.openFork(this.nativeId, lastTurnId, this.turnIds.slice(0, atTurn), opts?.cwd);
    } catch (e) {
      child.dispose();
      throw new Error(`分支失败：${errMsg(e)}`);
    }
    return child;
  }

  async close(): Promise<void> {
    this.dispose();
  }

  // ───────────── internals ─────────────

  dispose(): void {
    this.closed = true;
    this.conn?.kill();
    this.events.close();
  }

  async startTurn(text: string): Promise<void> {
    this.busy = true;
    try {
      const res = await this.conn.request("turn/start", { threadId: this.nativeId, input: textInput(text) });
      if (this.busy && !this.activeTurnId && res?.turn?.status === "inProgress") this.activeTurnId = String(res.turn.id);
    } catch (e) {
      this.busy = false;
      this.activeTurnId = null;
      throw e;
    }
  }

  /** Rebuild turn ids from the server (resume without hydrated history). */
  private async loadTurnIds(): Promise<void> {
    try {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page: any = await this.conn.request("thread/turns/list", {
          threadId: this.nativeId, cursor, limit: 100, sortDirection: "asc", itemsView: "notLoaded",
        });
        for (const t of page.data ?? []) ids.push(String(t.id));
        cursor = page.nextCursor ?? null;
      } while (cursor);
      if (ids.length > this.turnIds.length) { this.turnIds = ids; this.turnNo = Math.max(this.turnNo, ids.length); }
    } catch { /* keep what we have; fork() reports the missing turn */ }
  }

  private onNotification(n: RpcNotification): void {
    if (this.closed) return;
    const p = n.params ?? {};
    if (p.threadId && this.nativeId && p.threadId !== this.nativeId) return; // sub-agent threads etc.
    switch (n.method) {
      case "turn/started": {
        this.busy = true;
        this.activeTurnId = String(p.turn.id);
        this.turnIds[this.turnNo] = this.activeTurnId;
        this.turnNo++;
        this.tokenBaseline = this.tokenTotal;
        this.lastError = undefined;
        this.events.push({ t: "turn_start", turn: this.turnNo });
        return;
      }
      case "item/started": {
        if (p.item?.type === "fileChange") this.fileChanges.set(String(p.item.id), p.item.changes ?? []);
        return;
      }
      case "item/agentMessage/delta": {
        this.streamed.add(String(p.itemId));
        this.events.push({ t: "text_delta", delta: String(p.delta ?? "") });
        return;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const via = n.method === "item/reasoning/textDelta" ? "raw" : "summary";
        const index = Number(via === "raw" ? p.contentIndex : p.summaryIndex) || 0;
        const delta = String(p.delta ?? "");
        const key = String(p.itemId);
        const cur = this.reasoning.get(key);
        // 同一个推理块优先展示先到的那一路（通常是摘要），避免摘要与原文重复。
        if (!delta || (cur && cur.via !== via)) return;
        const gap = cur && cur.index !== index ? "\n\n" : "";
        this.reasoning.set(key, { via, index });
        this.events.push({ t: "thinking_delta", delta: gap + delta });
        return;
      }
      case "item/completed": {
        const item = p.item;
        if (item?.type === "reasoning") {
          const streamed = this.reasoning.delete(String(item.id));
          const parts = (xs: unknown): string => (Array.isArray(xs) ? xs.map(String).filter((x) => x.trim()).join("\n\n") : "");
          const full = streamed ? "" : parts(item.summary) || parts(item.content);
          if (full) this.events.push({ t: "thinking_delta", delta: full });
          if (streamed || full) this.events.push({ t: "thinking_done" });
        } else if (item?.type === "agentMessage") {
          if (!this.streamed.has(String(item.id)) && item.text) this.events.push({ t: "text_delta", delta: String(item.text) });
          this.streamed.delete(String(item.id));
          this.events.push({ t: "text_done" });
        } else {
          for (const e of itemToEvents(item)) this.events.push(e);
          if (item?.type === "fileChange") this.fileChanges.delete(String(item.id));
        }
        return;
      }
      case "thread/tokenUsage/updated": {
        const total = p.tokenUsage?.total?.totalTokens;
        if (typeof total === "number") this.tokenTotal = total;
        return;
      }
      case "error": {
        if (!p.willRetry) this.lastError = p.error?.message;
        return;
      }
      case "serverRequest/resolved": {
        this.approvals.delete(String(p.requestId));
        return;
      }
      case "turn/completed": {
        const turn = p.turn ?? {};
        const status = turn.status === "completed" || turn.status === "interrupted" ? turn.status : "failed";
        const tokens = this.tokenTotal - this.tokenBaseline;
        const ev: DriverEvent = { t: "turn_end", status };
        if (status === "failed") ev.error = turn.error?.message ?? this.lastError ?? "Codex 执行失败";
        if (tokens > 0) ev.usage = { tokens };
        this.busy = false;
        this.activeTurnId = null;
        this.approvals.clear();
        this.events.push(ev);
        this.drainQueue();
        return;
      }
    }
  }

  private drainQueue(): void {
    const next = this.queued.shift();
    if (next === undefined || this.closed) return;
    this.startTurn(next).catch((e) => {
      this.events.push({ t: "turn_end", status: "failed", error: errMsg(e) });
      this.drainQueue();
    });
  }

  private onServerRequest(r: RpcServerRequest): void {
    if (this.closed) return;
    const p = r.params ?? {};
    const key = String(r.id);
    if (r.method === "item/commandExecution/requestApproval") {
      this.approvals.set(key, { rpcId: r.id, method: r.method });
      const lines: string[] = [];
      if (p.command) lines.push(String(p.command));
      if (p.cwd) lines.push(`目录：${p.cwd}`);
      if (p.reason) lines.push(`原因：${p.reason}`);
      this.events.push({
        t: "approval",
        requestId: key,
        title: p.kind === "writeStdin" ? "向运行中的命令写入输入" : "运行命令",
        detail: truncate(lines.join("\n"), 1000) || undefined,
        risk: commandRisk(p.command, p.commandActions, !!p.networkApprovalContext),
      });
      return;
    }
    if (r.method === "item/fileChange/requestApproval") {
      this.approvals.set(key, { rpcId: r.id, method: r.method });
      const changes = this.fileChanges.get(String(p.itemId)) ?? [];
      const lines: string[] = [];
      if (changes.length) lines.push(toDiffFiles(changes).map((f) => `${f.path} (+${f.additions} -${f.deletions})`).join("\n"));
      if (p.grantRoot) lines.push(`请求目录写权限：${p.grantRoot}`);
      if (p.reason) lines.push(`原因：${p.reason}`);
      this.events.push({
        t: "approval",
        requestId: key,
        title: "修改文件",
        detail: truncate(lines.join("\n"), 1000) || undefined,
        risk: p.grantRoot ? "high" : "medium",
      });
      return;
    }
    // Unsupported server requests (user input, MCP elicitation, dynamic tools, auth refresh…): fail them fast
    // so Codex never waits on a client that cannot answer.
    this.conn.respondError(r.id, -32601, `Muster 暂不支持 ${r.method}`);
  }

  private onExit(info: { code: number | null; error?: string }): void {
    if (this.closed) return;
    this.closed = true;
    if (this.busy) {
      this.events.push({ t: "turn_end", status: "failed", error: info.error ?? "codex app-server 意外退出" });
      this.busy = false;
    }
    this.events.close();
  }
}

export function createCodexDriver(o?: CodexDriverOptions): AgentDriver {
  const command = o?.command ?? "codex";
  const resolved: Resolved = {
    command,
    args: o?.args ?? ["app-server"],
    approvalPolicy: o?.approvalPolicy ?? "on-request",
    sandbox: o?.sandbox ?? "workspace-write",
    requestTimeoutMs: o?.requestTimeoutMs,
  };

  return {
    kind: "codex",

    async detect(): Promise<DetectedAgent> {
      const line = await runVersion(command);
      const version = line ? /(\d+\.\d+\.\d+\S*)/.exec(line)?.[1] : undefined;
      return { engine: "codex", command, found: line !== null, ...(version ? { version } : {}) };
    },

    async start(opts: StartSessionOpts): Promise<DriverSession> {
      const s = new CodexSession(resolved);
      await s.connect();
      try {
        if (opts.resumeNativeId) await s.openResume(opts.resumeNativeId, opts.cwd, opts.model);
        else await s.openNew(opts.cwd, opts.model);
        if (opts.prompt.trim()) await s.startTurn(opts.prompt);
      } catch (e) {
        s.dispose();
        throw new Error(`启动 Codex 会话失败：${errMsg(e)}`);
      }
      return s;
    },
  };
}
