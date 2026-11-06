// 消息流的纯函数：按“轮”折叠过程、合并连续的工具调用与派发。主线和工单详情共用，无 React 依赖。
import type { Entry } from "@muster/protocol";

export type ToolEntry = Extract<Entry, { kind: "tool_summary" }>;
export type DispatchEntry = Extract<Entry, { kind: "dispatch" }>;

export type StreamBlock =
  | { type: "entry"; key: string; entry: Entry }
  /** 连续的工具调用合成一行；running = 这一组还在进行（流的最后一块且会话仍在工作）。 */
  | { type: "tools"; key: string; entries: ToolEntry[]; running: boolean }
  /** 连续的派发合成一个任务组。 */
  | { type: "dispatches"; key: string; entries: DispatchEntry[] }
  /** 已结束的一轮里的过程（思考、工具调用、中间文字），折叠成“已处理 N 步 · 用时”。 */
  | { type: "process"; key: string; steps: number; durationMs?: number; blocks: StreamBlock[] };

/** 一条工具汇总代表几次调用：计数与明细取较大者（明细可能被截断）。 */
export function toolCallCount(e: Pick<ToolEntry, "reads" | "commands" | "edits" | "items">): number {
  return Math.max(e.reads + e.commands + e.edits, e.items.length);
}

/** 毫秒 -> "8s" / "2m10s" / "1h05m"（流里的紧凑用时）。 */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

const startsTurn = (e: Entry) => e.kind === "user" || e.kind === "steer";

/** 按你的消息（含插话）切成若干轮；第一条你的消息之前的内容自成一轮。 */
function splitTurns(entries: Entry[]): Entry[][] {
  const turns: Entry[][] = [];
  for (const e of entries) {
    if (startsTurn(e) || turns.length === 0) turns.push([e]);
    else turns[turns.length - 1]!.push(e);
  }
  return turns;
}

function stepsOf(e: Entry): number {
  return e.kind === "tool_summary" ? toolCallCount(e) : 1;
}

/** 合并连续的工具调用、连续的派发。live：会话仍在工作，最后一组工具调用算“进行中”。 */
export function groupRuns(entries: Entry[], live: boolean): StreamBlock[] {
  const out: StreamBlock[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.kind === "tool_summary") {
      if (last?.type === "tools") last.entries.push(entry);
      else out.push({ type: "tools", key: entry.id, entries: [entry], running: false });
    } else if (entry.kind === "dispatch") {
      if (last?.type === "dispatches") last.entries.push(entry);
      else out.push({ type: "dispatches", key: entry.id, entries: [entry] });
    } else out.push({ type: "entry", key: entry.id, entry });
  }
  const tail = out[out.length - 1];
  if (live && tail?.type === "tools") tail.running = true;
  return out;
}

/**
 * 把一串条目变成要渲染的块。
 * 一轮结束后（后面已有你的新消息，或会话不再工作），这一轮的思考、工具调用和中间文字收成一个“过程”块，
 * 放在第一步的位置；最后一条回答、派发、确认、改动、测试结果、选项等照常显示。过程不足 2 步时不折叠。
 */
export function buildStream(entries: Entry[], live: boolean): StreamBlock[] {
  const turns = splitTurns(entries);
  const flat: (Entry | Extract<StreamBlock, { type: "process" }>)[] = [];
  turns.forEach((turn, i) => {
    const finished = (i < turns.length - 1 || !live) && !turn.some((e) => (e.kind === "bot" || e.kind === "thinking") && e.streaming);
    let finalIdx = -1;
    turn.forEach((e, idx) => {
      if (e.kind === "bot") finalIdx = idx;
    });
    const isProcess = (e: Entry, idx: number) => e.kind === "thinking" || e.kind === "tool_summary" || (e.kind === "bot" && idx !== finalIdx);
    const process = turn.filter(isProcess);
    if (!finished || process.length < 2) {
      flat.push(...turn);
      return;
    }
    const start = Date.parse(turn[0]!.ts);
    const end = Date.parse(turn[finalIdx >= 0 ? finalIdx : turn.length - 1]!.ts);
    const span = end - start;
    const fold = {
      type: "process" as const,
      key: `process-${process[0]!.id}`,
      steps: process.reduce((n, e) => n + stepsOf(e), 0),
      ...(Number.isFinite(span) && span >= 1000 ? { durationMs: span } : {}),
      blocks: groupRuns(process, false),
    };
    let placed = false;
    turn.forEach((e, idx) => {
      if (!isProcess(e, idx)) flat.push(e);
      else if (!placed) {
        flat.push(fold);
        placed = true;
      }
    });
  });

  const out: StreamBlock[] = [];
  let run: Entry[] = [];
  const flush = (isTail: boolean) => {
    if (run.length) out.push(...groupRuns(run, live && isTail));
    run = [];
  };
  for (const item of flat) {
    if ("kind" in item) run.push(item);
    else {
      flush(false);
      out.push(item);
    }
  }
  flush(true);
  return out;
}

/** 块的说话人（用于决定是否在前面放“头像 · 名字”一行）；你的消息为 "user"，中性内容为 null。 */
export function blockSpeaker(b: StreamBlock): string | null {
  switch (b.type) {
    case "tools":
      return b.entries[0]!.botId;
    case "process":
      return b.blocks.length ? blockSpeaker(b.blocks[0]!) : null;
    case "dispatches":
      return null;
    case "entry": {
      const e = b.entry;
      if (e.kind === "user" || e.kind === "steer") return "user";
      if (e.kind === "bot" || e.kind === "thinking" || e.kind === "tool_summary" || e.kind === "diff" || e.kind === "test_result") return e.botId;
      return null;
    }
  }
}
