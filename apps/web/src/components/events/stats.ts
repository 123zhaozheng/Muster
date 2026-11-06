import type { EventSource, HubEvent, TriggerRule } from "@muster/protocol";
import { dayDiff } from "./time";

export interface EventStats {
  today: number;
  /** Percent change vs yesterday; undefined when yesterday had no events. */
  trend?: number;
  /** Events per day for the last 7 days, oldest first (last item = today). */
  daily: number[];
  /** Events per source over the last 7 days. */
  bySource: Partial<Record<EventSource, number>>;
  sourceTotal: number;
  triggerTotal: number;
  triggerEnabled: number;
  /** Today's events produced by an `auto` rule that actually ran. */
  autoToday: number;
}

export function computeEventStats(events: HubEvent[], triggers: TriggerRule[], now: number): EventStats {
  const daily = new Array<number>(7).fill(0);
  const bySource: Partial<Record<EventSource, number>> = {};
  let sourceTotal = 0;
  let yesterday = 0;
  let autoToday = 0;
  const modeOf = new Map(triggers.map((t) => [t.id, t.mode] as const));
  for (const e of events) {
    const diff = dayDiff(new Date(e.ts).getTime(), now);
    if (diff < 0 || diff > 6) continue;
    daily[6 - diff]! += 1;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    sourceTotal += 1;
    if (diff === 1) yesterday += 1;
    if (diff === 0 && e.triggerId && modeOf.get(e.triggerId) === "auto" && (e.status === "delivered" || e.status === "dispatched")) autoToday += 1;
  }
  const today = daily[6]!;
  return {
    today,
    trend: yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : undefined,
    daily,
    bySource,
    sourceTotal,
    triggerTotal: triggers.length,
    triggerEnabled: triggers.filter((t) => t.enabled).length,
    autoToday,
  };
}
