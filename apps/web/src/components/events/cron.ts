import { Cron } from "croner";
import type { TriggerRule } from "@muster/protocol";

/** Quick picks shown in the rule editor. */
export const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "每天 9 点", expr: "0 9 * * *" },
  { label: "每小时", expr: "0 * * * *" },
  { label: "每 30 分钟", expr: "*/30 * * * *" },
  { label: "工作日 9 点", expr: "0 9 * * 1-5" },
  { label: "每周一 10 点", expr: "0 10 * * 1" },
  { label: "每月 1 号", expr: "0 9 1 * *" },
];

export const TIMEZONES = ["Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles"];

export type CronCheck = { ok: true; next: Date[] } | { ok: false; error: string };

/** Same library the daemon uses, so the preview equals what will really fire. */
export function checkCron(expr: string, tz: string, count = 3, from: Date = new Date()): CronCheck {
  if (!expr.trim()) return { ok: false, error: "请填写 cron 表达式" };
  try {
    const job = new Cron(expr.trim(), { timezone: tz.trim() || undefined, paused: true });
    const next = job.nextRuns(count, from);
    job.stop();
    if (next.length === 0) return { ok: false, error: "这个表达式永远不会触发" };
    return { ok: true, next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "cron 表达式或时区不合法" };
  }
}

/** Next scheduled run of a cron rule; null for other sources or invalid expressions. */
export function nextFireOf(rule: Pick<TriggerRule, "source" | "params">, from: Date = new Date()): Date | null {
  if (rule.source !== "cron") return null;
  const r = checkCron(rule.params.expr ?? "", rule.params.tz ?? "", 1, from);
  return r.ok ? r.next[0]! : null;
}

interface Zoned {
  y: number;
  m: number;
  d: number;
  hh: string;
  mm: string;
  wd: string;
}
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function zoned(date: Date, tz?: string): Zoned {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  return { y, m, d, hh: get("hour").padStart(2, "0"), mm: get("minute").padStart(2, "0"), wd: WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]! };
}

/** "今天 09:00" / "明天 09:00" / "11月9日 周一 09:00", rendered in the rule's time zone. */
export function formatFireTime(date: Date, tz: string | undefined, now: Date = new Date()): string {
  const a = zoned(date, tz);
  const b = zoned(now, tz);
  const diff = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
  const clock = `${a.hh}:${a.mm}`;
  if (diff === 0) return `今天 ${clock}`;
  if (diff === 1) return `明天 ${clock}`;
  return `${a.m}月${a.d}日 ${a.wd} ${clock}`;
}
