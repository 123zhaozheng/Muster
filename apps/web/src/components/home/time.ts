import type { Task } from "@muster/protocol";

const MIN = 60_000;

/** 时长 -> "刚开始" / "3 分钟" / "1 小时 20 分钟" / "2 天"（粗粒度，用于预估与历史）。 */
export function formatDuration(ms: number): string {
  if (ms < MIN) return "不到 1 分钟";
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} 小时 ${min % 60} 分钟` : `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}

/** 已用时长（带秒，随时钟每秒刷新）：`42 秒` / `5 分 07 秒` / `1 小时 20 分` / `2 天 3 小时`。 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${String(s % 60).padStart(2, "0")} 秒`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
  return h % 24 ? `${Math.floor(h / 24)} 天 ${h % 24} 小时` : `${Math.floor(h / 24)} 天`;
}

/** ISO 时间 -> "刚刚" / "5 分钟前" / "3 小时前" / "2 天前"。 */
export function relativeAgo(iso: string, now: number): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < MIN) return "刚刚";
  if (diff < 60 * MIN) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < 24 * 60 * MIN) return `${Math.floor(diff / (60 * MIN))} 小时前`;
  return `${Math.floor(diff / (24 * 60 * MIN))} 天前`;
}

/**
 * 派发卡底部的时间文案：进行中显示“已用/预计还需”，结束后显示“用时”。
 * `now` 必须是已按 serverTime 校正过的时间（见 serverClock），否则跨机器时钟偏差会让已用时长失真。
 */
export function taskTimeText(task: Task, now: number): string {
  const start = Date.parse(task.startedAt);
  if (task.status === "queued") return "排队等待中";
  if (task.finishedAt) return `用时 ${formatDuration(Date.parse(task.finishedAt) - start)}`;
  const elapsed = Math.max(0, now - start);
  const p = task.progress;
  if (task.status === "running" && p !== undefined && p > 0 && p < 100) {
    return `已用 ${formatElapsed(elapsed)} · 预计还需 ${formatDuration((elapsed * (100 - p)) / p)}`;
  }
  return `已用 ${formatElapsed(elapsed)}`;
}

/** 问候语：按本地小时。 */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return "早上好";
  if (hour >= 11 && hour < 13) return "中午好";
  if (hour >= 13 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}

/** 一句今日概况：“3 个任务进行中，1 件事等你”。 */
export function summaryLine(active: number, pending: number): string {
  if (active === 0 && pending === 0) return "手头暂时清闲，想让我安排点什么？";
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} 个任务进行中`);
  parts.push(pending > 0 ? `${pending} 件事等你` : "没有需要你处理的事");
  return parts.join("，");
}

/** 某时区当前的“分钟数”（0..1439）。 */
function minutesOfDay(now: number, tz?: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(now));
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  } catch {
    const d = new Date(now);
    return d.getHours() * 60 + d.getMinutes();
  }
}

/**
 * 只识别“每天固定时刻”的 cron（`m h * * *`），返回“今天 09:00 / 明天 09:00”；其它表达式返回 null。
 * 不做完整 cron 解析：调度本身由 daemon 负责，这里只是展示。
 */
export function nextDailyRun(expr: string, tz: string | undefined, now: number): string | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr.trim());
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  const day = hour * 60 + minute > minutesOfDay(now, tz) ? "今天" : "明天";
  return `${day} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 消息时间：当天 `HH:mm`，否则 `M月D日 HH:mm`。 */
export function clockLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const n = new Date(now);
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 本地“同一天”判断，用于“今日完成”。 */
export function isSameLocalDay(iso: string | undefined, now: number): boolean {
  if (!iso) return false;
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
