// 触发器的持久化状态：GitHub 已见集合、cron 上次计划时间、待用户确认的 ask 请求。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** ask 模式下等待用户批准的请求；批准后据此启动任务（重启后依然有效）。 */
export interface PendingAsk {
  triggerId: string;
  botId: string;
  title: string;
  prompt: string;
}

export interface TriggerState {
  /** 是否已种过示例触发器（用户全删后不应再种）。 */
  seeded: boolean;
  /** `${repo}|${event}|${eventId}`，按插入顺序，超出上限丢最旧的。 */
  seen: Set<string>;
  /** 已建立基线的 `${repo}|${event}`：首次轮询只记录现有事件，不触发。 */
  baselined: Set<string>;
  /** cron 触发器：当前表达式签名 + 上次已处理的计划时刻（用于重启后补跑）。 */
  cronState: Record<string, { sig: string; last: string }>;
  pendingAsks: Record<string, PendingAsk>;
}

export const SEEN_CAP = 2000;

export function emptyState(): TriggerState {
  return { seeded: false, seen: new Set(), baselined: new Set(), cronState: {}, pendingAsks: {} };
}

export function loadState(file: string): TriggerState {
  const st = emptyState();
  if (!existsSync(file)) return st;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    st.seeded = raw.seeded === true;
    if (Array.isArray(raw.seen)) for (const s of raw.seen) if (typeof s === "string") st.seen.add(s);
    if (Array.isArray(raw.baselined)) for (const s of raw.baselined) if (typeof s === "string") st.baselined.add(s);
    if (raw.cronState && typeof raw.cronState === "object") st.cronState = raw.cronState as TriggerState["cronState"];
    if (raw.pendingAsks && typeof raw.pendingAsks === "object") st.pendingAsks = raw.pendingAsks as TriggerState["pendingAsks"];
  } catch (e) {
    console.warn("[triggers] state file unreadable, starting fresh:", (e as Error).message);
  }
  return st;
}

/** 先写临时文件再改名，避免写到一半崩溃留下坏文件。 */
export function saveState(file: string, st: TriggerState): void {
  while (st.seen.size > SEEN_CAP) {
    const oldest = st.seen.values().next().value;
    if (oldest === undefined) break;
    st.seen.delete(oldest);
  }
  const body = JSON.stringify({ version: 1, seeded: st.seeded, seen: [...st.seen], baselined: [...st.baselined], cronState: st.cronState, pendingAsks: st.pendingAsks });
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, file);
}
