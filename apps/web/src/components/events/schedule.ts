import type { Device, HubEvent, TriggerRule } from "@muster/protocol";
import type { Tone } from "@muster/ui";
import { describeCron, formatFireAt, nextFireOf } from "./cron";
import { EVENT_STATUS, GITHUB_EVENTS } from "./meta";
import { relativeTime } from "../../lib/format";

/** What makes the rule fire, in plain language ("每天 09:00", "shop-api · PR 打开"). */
export function frequencyOf(t: TriggerRule, devices: Record<string, Device>): string {
  const p = t.params;
  if (t.source === "cron") return describeCron(p.expr ?? "");
  if (t.source === "github") {
    const ev = GITHUB_EVENTS.find((e) => e.value === p.event)?.label ?? p.event ?? "";
    return [p.repo, ev].filter(Boolean).join(" · ");
  }
  if (t.source === "device") return `${devices[p.deviceId ?? ""]?.name ?? "指定设备"} 上线时`;
  return "子成员完成任务时";
}

interface NextRun {
  /** "11月7日 周六 09:00", or a sentence when there is no fixed time. */
  text: string;
  /** Time zone the time is shown in; only for timed runs. */
  tz?: string;
  at?: Date;
}

/** Next run of a rule, with the concrete date and the time zone the schedule is evaluated in. */
export function nextRunOf(t: TriggerRule, from: Date): NextRun {
  if (!t.enabled) return { text: "已停用" };
  if (t.source !== "cron") return { text: "有事件时触发" };
  const at = nextFireOf(t, from);
  if (!at) return { text: "表达式无效" };
  const tz = t.params.tz?.trim();
  return { text: formatFireAt(at, tz), tz: tz || "本地时区", at };
}

interface LastResult {
  text: string;
  tone: Tone;
}

/** Latest outcome of a rule, from the event log (newest first); falls back to lastFiredAt. */
export function lastResultOf(t: TriggerRule, events: HubEvent[], now: number): LastResult {
  const last = events.find((e) => e.triggerId === t.id);
  if (last) {
    const s = last.status ? EVENT_STATUS[last.status] : undefined;
    return { text: `${s?.label ?? "已触发"} · ${relativeTime(last.ts, now)}`, tone: s?.tone ?? "neutral" };
  }
  if (t.lastFiredAt) return { text: `已触发 · ${relativeTime(t.lastFiredAt, now)}`, tone: "neutral" };
  return { text: "尚未触发", tone: "neutral" };
}

/** Enabled timed rules ordered by their next run. */
export function upcomingRuns(triggers: TriggerRule[], now: number, limit = 3): { trigger: TriggerRule; run: NextRun }[] {
  const from = new Date(now);
  return triggers
    .map((trigger) => ({ trigger, run: nextRunOf(trigger, from) }))
    .filter((x): x is { trigger: TriggerRule; run: NextRun & { at: Date } } => x.run.at !== undefined)
    .sort((a, b) => a.run.at.getTime() - b.run.at.getTime())
    .slice(0, limit);
}
