import { useEffect, useState } from "react";

/** "刚刚" / "2分钟前" / "3小时前" / "2天前". */
export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  return `${Math.floor(hour / 24)}天前`;
}

/** Current time that refreshes every `intervalMs` so relative labels stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Local-midnight timestamp of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local calendar days between `ts` and `now` (0 = same day). */
export function dayDiff(ts: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
}

/** "今天" / "昨天" / "11月4日 周三". */
export function dayLabel(iso: string, now: number): string {
  const ts = new Date(iso).getTime();
  const diff = dayDiff(ts, now);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}`;
}

/** "09:05" in local time. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-11-06 09:05:12" in local time. */
export function fullTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(iso)}:${pad(d.getSeconds())}`;
}

export interface DayGroup<T> {
  /** Stable key: local YYYY-MM-DD. */
  key: string;
  label: string;
  items: T[];
}

/** Groups items (already sorted newest first) by local calendar day, preserving order. */
export function groupByDay<T extends { ts: string }>(items: T[], now: number): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const it of items) {
    const d = new Date(it.ts);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, label: dayLabel(it.ts, now), items: [it] });
  }
  return groups;
}
