// OWNER: B4. Pure mapping: Claude Code stream-json messages -> normalised DriverEvents.
// No I/O here, so it can be unit-tested with canned messages.
import { isAbsolute, relative } from "node:path";
import type { DiffFile, Risk } from "@muster/protocol";
import type { DriverEvent } from "../../core/contracts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

type ToolKind = "read" | "command" | "edit" | "other";
interface ToolInfo {
  tool: string;
  kind: ToolKind;
  label: string;
}

export interface PendingApproval {
  requestId: string;
  input: Rec;
}

function relPath(cwd: string, p: string): string {
  if (!isAbsolute(p)) return p.replace(/\\/g, "/");
  const rel = relative(cwd, p);
  return (!rel || rel.startsWith("..") || isAbsolute(rel) ? p : rel).replace(/\\/g, "/");
}

/** Map a Claude tool call to the normalised (tool, kind, label) triple. */
export function describeTool(name: string, input: Rec, cwd: string): ToolInfo {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  switch (name) {
    case "Read":
      return { tool: "read", kind: "read", label: file ? relPath(cwd, file) : "文件" };
    case "Bash":
    case "PowerShell":
      return { tool: "bash", kind: "command", label: clip((str(input.command) ?? "").split("\n")[0]?.trim() ?? "", 200) };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return { tool: "edit", kind: "edit", label: file ? relPath(cwd, file) : "文件" };
    case "Grep":
      return { tool: "grep", kind: "other", label: clip(str(input.pattern) ?? "", 200) };
    case "Glob":
      return { tool: "glob", kind: "other", label: clip(str(input.pattern) ?? "", 200) };
    case "WebFetch":
      return { tool: "fetch", kind: "other", label: clip(str(input.url) ?? "", 200) };
    case "WebSearch":
      return { tool: "search", kind: "other", label: clip(str(input.query) ?? "", 200) };
    case "Task":
    case "Agent":
      return { tool: "agent", kind: "other", label: clip(str(input.description) ?? name, 200) };
    case "TodoWrite":
      return { tool: "todo", kind: "other", label: "更新待办" };
    default:
      return { tool: name.toLowerCase(), kind: "other", label: name };
  }
}

const RISKY_COMMAND = /\b(rm|rmdir|del|sudo|chmod|chown|mkfs|dd|format|curl|wget|ssh|scp)\b|git\s+(push|reset|clean)|npm\s+publish|\|\s*(sh|bash)\b/i;

function riskOf(name: string, kind: ToolKind, input: Rec): Risk {
  if (kind === "read") return "low";
  if (kind === "command") return RISKY_COMMAND.test(str(input.command) ?? "") ? "high" : "medium";
  if (name === "WebFetch" || name === "WebSearch" || name === "Grep" || name === "Glob") return "low";
  return "medium";
}

function patchOf(path: string, pairs: Array<[string, string]>): DiffFile {
  const lines = (s: string) => (s === "" ? [] : s.split("\n"));
  let additions = 0;
  let deletions = 0;
  const body: string[] = [];
  for (const [o, n] of pairs) {
    const ol = lines(o);
    const nl = lines(n);
    deletions += ol.length;
    additions += nl.length;
    body.push("@@", ...ol.map((l) => `-${l}`), ...nl.map((l) => `+${l}`));
  }
  return { path, additions, deletions, patch: clip(`--- a/${path}\n+++ b/${path}\n${body.join("\n")}`, 4000) };
}

/** Best-effort diff derived from the tool input (the engine does not stream diffs). */
function diffOf(name: string, input: Rec, path: string): DiffFile | undefined {
  if (name === "Edit") return patchOf(path, [[str(input.old_string) ?? "", str(input.new_string) ?? ""]]);
  if (name === "Write") return patchOf(path, [["", str(input.content) ?? ""]]);
  if (name === "MultiEdit") {
    const pairs = arr(input.edits).map((e): [string, string] => [str(rec(e)?.old_string) ?? "", str(rec(e)?.new_string) ?? ""]);
    return pairs.length ? patchOf(path, pairs) : undefined;
  }
  return undefined;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => str(rec(b)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function sumUsage(u: unknown): { tokens: number; costUsd: number } | undefined {
  const byModel = rec(u);
  if (!byModel) return undefined;
  let tokens = 0;
  let costUsd = 0;
  let seen = false;
  for (const v of Object.values(byModel)) {
    const m = rec(v);
    if (!m) continue;
    seen = true;
    tokens += (num(m.inputTokens) ?? 0) + (num(m.outputTokens) ?? 0) + (num(m.cacheReadInputTokens) ?? 0) + (num(m.cacheCreationInputTokens) ?? 0);
    costUsd += num(m.costUSD) ?? 0;
  }
  return seen ? { tokens, costUsd } : undefined;
}

export class ClaudeStreamMapper {
  /** Number of the current (or last finished) turn. 1-based; 0 before the first one. */
  turn: number;
  inTurn = false;
  /** Outstanding `can_use_tool` requests, keyed by control request id. */
  readonly pending = new Map<string, PendingApproval>();
  /** Uuid of the last top-level assistant message per turn (used to fork "up to the end of turn N"). */
  readonly lastAssistantUuid = new Map<number, string>();

  private readonly cwd: string;
  private readonly tools = new Map<string, { name: string; input: Rec }>();
  private readonly streamed = new Set<string>(); // assistant message ids whose text was already streamed
  private readonly blocks = new Map<number, string>(); // content block index -> type, for the current message
  private msgId = "";
  private interrupting = false;
  private prevCost = 0;
  private prevTokens = 0;

  constructor(o: { cwd: string; turn?: number }) {
    this.cwd = o.cwd;
    this.turn = o.turn ?? 0;
  }

  /** Begin a turn explicitly (the first prompt is written right at start). */
  beginTurn(): DriverEvent[] {
    if (this.inTurn) return [];
    this.inTurn = true;
    this.turn += 1;
    return [{ t: "turn_start", turn: this.turn }];
  }

  /** Remember that the user asked to interrupt; the next `result` is reported as interrupted. */
  markInterrupt(): boolean {
    if (!this.inTurn) return false;
    this.interrupting = true;
    return true;
  }

  handle(raw: unknown): DriverEvent[] {
    const m = rec(raw);
    if (!m) return [];
    switch (str(m.type)) {
      case "stream_event":
        return this.onStream(m);
      case "assistant":
        return this.onAssistant(m);
      case "user":
        return this.onUser(m);
      case "control_request":
        return this.onControlRequest(m);
      case "control_cancel_request":
        this.pending.delete(str(m.request_id) ?? "");
        return [];
      case "result":
        return this.onResult(m);
      default:
        return []; // system / status / hook events carry nothing the UI needs
    }
  }

  private onStream(m: Rec): DriverEvent[] {
    if (m.parent_tool_use_id) return []; // sub-agent partials are not forwarded by the CLI anyway
    const ev = rec(m.event);
    if (!ev) return [];
    const out = this.beginTurn();
    switch (str(ev.type)) {
      case "message_start":
        this.msgId = str(rec(ev.message)?.id) ?? str(m.api_message_id) ?? "";
        this.blocks.clear();
        break;
      case "content_block_start":
        this.blocks.set(num(ev.index) ?? -1, str(rec(ev.content_block)?.type) ?? "");
        break;
      case "content_block_delta": {
        const d = rec(ev.delta);
        const text = str(d?.text);
        if (str(d?.type) === "text_delta" && text) {
          this.streamed.add(this.msgId);
          out.push({ t: "text_delta", delta: text });
        }
        break;
      }
      case "content_block_stop": {
        const idx = num(ev.index) ?? -1;
        if (this.blocks.get(idx) === "text") out.push({ t: "text_done" });
        this.blocks.delete(idx);
        break;
      }
    }
    return out;
  }

  private onAssistant(m: Rec): DriverEvent[] {
    const msg = rec(m.message);
    if (!msg) return [];
    const out = this.beginTurn();
    const topLevel = !m.parent_tool_use_id;
    const uuid = str(m.uuid);
    if (topLevel && uuid) this.lastAssistantUuid.set(this.turn, uuid);
    for (const b of arr(msg.content)) {
      const block = rec(b);
      if (!block) continue;
      if (block.type === "tool_use") {
        const id = str(block.id);
        if (id) this.tools.set(id, { name: str(block.name) ?? "", input: rec(block.input) ?? {} });
      } else if (block.type === "text" && topLevel) {
        // Only reached with text that was not streamed (partial messages off / missed).
        const text = str(block.text);
        if (text && !this.streamed.has(str(msg.id) ?? "")) out.push({ t: "text_delta", delta: text }, { t: "text_done" });
      }
    }
    return out;
  }

  private onUser(m: Rec): DriverEvent[] {
    const content = arr(rec(m.message)?.content);
    const out: DriverEvent[] = [];
    for (const b of content) {
      const block = rec(b);
      if (!block || block.type !== "tool_result") continue;
      const call = this.tools.get(str(block.tool_use_id) ?? "");
      if (!call) continue;
      if (!out.length) out.push(...this.beginTurn());
      const info = describeTool(call.name, call.input, this.cwd);
      const ok = block.is_error !== true;
      const text = resultText(block.content).replace(/\n?Shell cwd was reset to .*$/m, "").trim();
      const ev: DriverEvent = { t: "tool", tool: info.tool, kind: info.kind, label: info.label, ok };
      // Read/edit output is noise (file bodies, "file updated"); keep it for commands and failures.
      if (text && (info.kind === "command" || info.kind === "other" || !ok)) ev.output = clip(text, 2000);
      out.push(ev);
      if (ok && info.kind === "edit") {
        const file = diffOf(call.name, call.input, info.label);
        if (file) out.push({ t: "diff", files: [file] });
      }
    }
    return out;
  }

  private onControlRequest(m: Rec): DriverEvent[] {
    const req = rec(m.request);
    const requestId = str(m.request_id);
    if (!req || !requestId || req.subtype !== "can_use_tool") return [];
    const name = str(req.tool_name) ?? "工具";
    const input = rec(req.input) ?? {};
    const info = describeTool(name, input, this.cwd);
    const out = this.beginTurn();
    this.pending.set(requestId, { requestId, input });
    const verb = { command: "运行命令", read: "读取文件", edit: "修改文件", other: `使用工具 ${name}` }[info.kind];
    const title = info.label && info.label !== name ? `${verb}：${info.label}` : verb;
    const detail = str(req.description) ?? str(req.decision_reason) ?? (info.kind === "command" ? str(input.command) : undefined);
    out.push({ t: "approval", requestId, title, detail: detail && clip(detail, 1000), risk: riskOf(name, info.kind, input) });
    return out;
  }

  private onResult(m: Rec): DriverEvent[] {
    const out = this.beginTurn();
    const failed = m.is_error === true || (str(m.subtype) ?? "success") !== "success";
    const status = this.interrupting ? "interrupted" : failed ? "failed" : "completed";
    const ev: Extract<DriverEvent, { t: "turn_end" }> = { t: "turn_end", status };
    if (status === "failed") ev.error = str(m.result) || str(m.subtype) || "Claude Code 执行失败";
    ev.usage = this.usageOf(m);
    if (!ev.usage) delete ev.usage;
    out.push(ev);
    this.inTurn = false;
    this.interrupting = false;
    this.pending.clear();
    return out;
  }

  /** Prefer the engine's per-turn figures; fall back to differencing the cumulative totals. */
  private usageOf(m: Rec): { tokens?: number; costUsd?: number } | undefined {
    const perTurn = sumUsage(m.model_usage_since_last_result);
    const totalCost = num(m.total_cost_usd);
    const u = rec(m.usage);
    const totalTokens = u
      ? (num(u.input_tokens) ?? 0) + (num(u.output_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0)
      : undefined;
    let costFallback: number | undefined;
    let tokenFallback: number | undefined;
    if (totalCost !== undefined) {
      costFallback = Math.max(0, totalCost - this.prevCost);
      this.prevCost = totalCost;
    }
    if (totalTokens !== undefined) {
      tokenFallback = Math.max(0, totalTokens - this.prevTokens);
      this.prevTokens = totalTokens;
    }
    const tokens = perTurn?.tokens ?? tokenFallback;
    const costUsd = perTurn?.costUsd ?? costFallback;
    if (tokens === undefined && costUsd === undefined) return undefined;
    const usage: { tokens?: number; costUsd?: number } = {};
    if (tokens !== undefined) usage.tokens = tokens;
    if (costUsd !== undefined) usage.costUsd = Math.round(costUsd * 1e6) / 1e6;
    return usage;
  }
}
