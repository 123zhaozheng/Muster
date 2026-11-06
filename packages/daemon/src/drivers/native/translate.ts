// 把 pi-durable 的会话视图（entries + pi.live）翻译成统一的 DriverEvent 流；纯逻辑，不触碰存储。
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, ToolResultEntry, type ConversationView, type EntryRecord } from "@earendil-works/pi-durable";
import type { DriverEvent, SendMode } from "../../core/contracts";

/** 我们自己写入的用户输入条目；data.mode 记录发送方式，用来区分“插话”与“新一轮”。 */
export const INPUT_KIND = "muster.input";

export interface InputData {
  mode: SendMode;
}

/** 非 steer 的输入开启新一轮；steer 只是并入当前这一轮。 */
export function startsTurn(entry: EntryRecord): boolean {
  return entry.kind === INPUT_KIND && (entry.data as InputData | undefined)?.mode !== "steer";
}

export interface TranslatorSeed {
  /** 已有的轮数（含正在进行的）。 */
  turn: number;
  /** 已处理到的最新条目 id；更早的条目不再翻译。 */
  lastEntryId: number;
}

const OUTPUT_LIMIT = 2000;

/** 逐个视图快照产出事件；每个条目只处理一次，流式文本按增量输出。 */
export class ViewTranslator {
  turn: number;
  /** 当前是否有一轮在进行（pi.live.run 存在）。 */
  active: boolean;
  #lastId: number;
  #emitted = "";
  #tokens = 0;
  #costUsd = 0;
  readonly #calls = new Map<string, { name: string; args: Record<string, unknown> }>();

  constructor(seed: TranslatorSeed, initial: ConversationView) {
    this.turn = seed.turn;
    this.#lastId = seed.lastEntryId;
    this.active = liveOf(initial).run !== undefined;
  }

  update(view: ConversationView): DriverEvent[] {
    const events: DriverEvent[] = [];
    for (const entry of view.entries) {
      if (entry.id <= this.#lastId) continue;
      this.#lastId = entry.id;
      this.#entry(entry, view, events);
    }
    const live = liveOf(view);
    if (this.active && live.run === undefined) this.#endTurn(view, events);
    else if (live.run !== undefined && live.generation?.message) {
      this.#textDelta(textOf(live.generation.message.content), events);
    }
    return events;
  }

  #entry(entry: EntryRecord, view: ConversationView, events: DriverEvent[]): void {
    const message = entry.model?.[0];
    if (entry.kind === INPUT_KIND) {
      const text = message?.role === "user" ? textOf(message.content) : "";
      if (!startsTurn(entry) && this.active) {
        events.push({ t: "steer_applied", text });
        return;
      }
      if (this.active) this.#endTurn(view, events);
      this.turn += 1;
      this.active = true;
      events.push({ t: "turn_start", turn: this.turn });
    } else if (AssistantEntry.is(entry) && message?.role === "assistant") {
      this.#assistant(message, events);
    } else if (ToolResultEntry.is(entry) && message?.role === "toolResult") {
      this.#toolResult(message, events);
    }
  }

  #assistant(message: AssistantMessage, events: DriverEvent[]): void {
    const text = textOf(message.content);
    this.#textDelta(text, events);
    if (text) events.push({ t: "text_done" });
    this.#emitted = "";
    this.#tokens += message.usage?.totalTokens ?? 0;
    this.#costUsd += message.usage?.cost?.total ?? 0;
    for (const block of message.content) {
      if (block.type === "toolCall") this.#calls.set(block.id, { name: block.name, args: block.arguments });
    }
  }

  #toolResult(message: ToolResultMessage, events: DriverEvent[]): void {
    const call = this.#calls.get(message.toolCallId);
    const name = call?.name ?? message.toolName;
    const output = textOf(message.content);
    events.push({
      t: "tool",
      tool: name,
      kind: toolKind(name),
      label: toolLabel(name, call?.args),
      ok: !message.isError,
      output: output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}…` : output,
    });
  }

  #textDelta(full: string, events: DriverEvent[]): void {
    // 重试后流式文本会从头开始；与已发出内容不连续时不再补发，避免重复。
    if (full.length <= this.#emitted.length || !full.startsWith(this.#emitted)) return;
    events.push({ t: "text_delta", delta: full.slice(this.#emitted.length) });
    this.#emitted = full;
  }

  #endTurn(view: ConversationView, events: DriverEvent[]): void {
    const failure = liveOf(view).runFailure;
    const usage = { tokens: this.#tokens, costUsd: this.#costUsd };
    if (failure === undefined) events.push({ t: "turn_end", status: "completed", usage });
    else if (failure.reason === "aborted") events.push({ t: "turn_end", status: "interrupted", usage });
    else events.push({ t: "turn_end", status: "failed", error: describeFailure(failure), usage });
    this.active = false;
    this.#emitted = "";
    this.#tokens = 0;
    this.#costUsd = 0;
  }
}

type LiveDoc = {
  run?: unknown;
  generation?: { message?: { content: AssistantMessage["content"] } };
  runFailure?: { reason: string; detail?: string };
};

// docs 是 JSON 对象；pi.live 的形状由 pi-durable 保证，这里只取需要的字段。
function liveOf(view: ConversationView): LiveDoc {
  return (view.docs["pi.live"] ?? {}) as LiveDoc;
}

/** 拼接内容里的文本块（忽略 thinking / toolCall / 图片）。 */
export function textOf(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
}

function toolKind(name: string): "read" | "command" | "edit" | "other" {
  if (name === "read" || name === "ls" || name === "grep" || name === "web_fetch") return "read";
  if (name === "bash" || name === "powershell") return "command";
  if (name === "edit" || name === "write") return "edit";
  return "other";
}

function toolLabel(name: string, args: Record<string, unknown> | undefined): string {
  const detail = args?.command ?? args?.path ?? args?.url ?? args?.pattern;
  return typeof detail === "string" ? `${name} ${detail}` : name;
}

const ERROR_LIMIT = 300;

/** 把 pi-durable 的运行失败转成用户能读懂的一句话；no_model 保持固定标识，供上层识别。 */
export function describeFailure(failure: { reason: string; detail?: string }): string {
  if (failure.reason === "no_model") return "no_model";
  const detail = (failure.detail ?? "").trim();
  if (failure.reason === "model_error") return describeModelError(detail);
  if (failure.reason === "turn_limit") return "这次任务的工具调用轮数达到上限，已暂停。可以让我继续。";
  return detail ? `${failure.reason}: ${detail.slice(0, ERROR_LIMIT)}` : failure.reason;
}

function describeModelError(detail: string): string {
  const status = /\b(?:status(?: code)?|HTTP|http)[^0-9]{0,6}([1-5]\d\d)\b/.exec(detail)?.[1] ?? /^\s*([1-5]\d\d)\b/.exec(detail)?.[1];
  const hint = "请到 设置 → 模型 检查";
  if (/No API key for provider/i.test(detail)) return `模型请求失败：这个模型服务还没有 API Key。${hint}并填写密钥。`;
  if (status === "401" || status === "403" || /unauthorized|invalid[_ ]api[_ ]key|incorrect api key|authentication/i.test(detail)) {
    return `模型请求失败：API Key 无效或没有权限${status ? `（HTTP ${status}）` : ""}。${hint}密钥。`;
  }
  if (status === "404") return `模型请求失败：找不到该模型或接口地址不对（HTTP 404）。${hint}接口地址和模型名。`;
  if (status === "429") return "模型请求失败：请求过于频繁或额度用完（HTTP 429）。稍后再试，或" + hint + "账户额度。";
  if (status && status.startsWith("5")) return `模型服务暂时不可用（HTTP ${status}）。稍后再试。`;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|network|socket|timed? ?out|connection/i.test(detail)) {
    return `模型请求失败：连不上模型服务。${hint}接口地址和网络。（${detail.slice(0, 120)}）`;
  }
  return `模型请求失败：${detail ? detail.slice(0, ERROR_LIMIT) : "未知错误"}`;
}

