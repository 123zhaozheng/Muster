/** 问候语：按本地小时。 */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return "早上好";
  if (hour >= 11 && hour < 13) return "中午好";
  if (hour >= 13 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}

interface ZonedNow {
  year: number;
  month: number;
  day: number;
  minutes: number;
}

/** 某时区当前的日期与“分钟数”（0..1439）；时区无效时退回本地时间。 */
function zonedNow(now: number, tz?: string): ZonedNow {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(now));
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
    return { year: get("year"), month: get("month"), day: get("day"), minutes: get("hour") * 60 + get("minute") };
  } catch {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

interface NextRun {
  /** “今天 11月6日 09:00” / “明天 11月7日 09:00”。 */
  label: string;
  /** 距今天 00:00 的分钟数，用来排先后。 */
  order: number;
}

/**
 * 只识别“每天固定时刻”的 cron（`m h * * *`）；其它表达式返回 null。
 * 不做完整 cron 解析：调度本身由 daemon 负责，这里只是展示。
 */
export function nextDailyRun(expr: string, tz: string | undefined, now: number): NextRun | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr.trim());
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  const at = hour * 60 + minute;
  const z = zonedNow(now, tz);
  const tomorrow = at <= z.minutes;
  const date = new Date(Date.UTC(z.year, z.month - 1, z.day + (tomorrow ? 1 : 0)));
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { label: `${tomorrow ? "明天" : "今天"} ${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${time}`, order: (tomorrow ? 1440 : 0) + at };
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
