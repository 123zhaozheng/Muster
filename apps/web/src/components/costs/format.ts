import type { HubEvent } from "@muster/protocol";

/** 前端生成并下载审计日志 JSON。 */
export function exportEventsJson(events: HubEvent[], now: Date = new Date()): void {
  const payload = { exportedAt: now.toISOString(), count: events.length, events };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `muster-audit-${now.toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const usd = (n: number | undefined): string => (n === undefined ? "—" : `$${n.toFixed(2)}`);
export const tokensText = (n: number | undefined): string => (n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
