// OWNER: W1. 相对时间文案（"刚刚 / 3 分钟前 / 2 小时前 / 昨天 / 5 天前"）。
export function relativeTime(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return day === 1 ? "昨天" : `${day} 天前`;
}
