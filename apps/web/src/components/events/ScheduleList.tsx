import type { ReactNode } from "react";
import type { Bot, BotId, Device, HubEvent, TriggerId, TriggerRule } from "@muster/protocol";
import { Card, StatusBadge, Switch, cn } from "@muster/ui";
import { MemberAvatar } from "../common";
import { setTriggerEnabled } from "./actions";
import { MODE_LABEL } from "./meta";
import { frequencyOf, lastResultOf, nextRunOf } from "./schedule";
import { SOURCE_LABEL } from "./SourceIcon";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

interface RowProps {
  rule: TriggerRule;
  bot?: Bot;
  devices: Record<string, Device>;
  events: HubEvent[];
  now: number;
  onEdit: (id: TriggerId) => void;
}

function ScheduleRow({ rule, bot, devices, events, now, onEdit }: RowProps) {
  const next = nextRunOf(rule, new Date(now));
  const last = lastResultOf(rule, events, now);
  return (
    <div data-testid="schedule-row" className={cn("grid items-center gap-x-6 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto]", !rule.enabled && "bg-surface-muted/50")}>
      <div className="min-w-0">
        <button
          type="button"
          aria-label={`编辑日程 ${rule.label}`}
          onClick={() => onEdit(rule.id)}
          className="block max-w-full cursor-pointer truncate rounded-control text-left text-body font-medium text-fg outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {rule.label}
        </button>
        <p className="mt-0.5 truncate text-sm text-fg-2" title={frequencyOf(rule, devices)}>
          {SOURCE_LABEL[rule.source]} · {frequencyOf(rule, devices)}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-caption text-fg-2">
          {bot && <MemberAvatar bot={bot} size={24} />}
          交给 {bot?.name ?? "未知成员"} · {MODE_LABEL[rule.mode]}模式
        </p>
      </div>
      <dl className="contents">
        <Field label="下次运行">
          {next.text}
          {next.tz && <span className="block text-caption text-fg-3">{next.tz}</span>}
        </Field>
        <Field label="最近结果">
          {last.tone === "neutral" ? <span className="text-fg-2">{last.text}</span> : <StatusBadge tone={last.tone}>{last.text}</StatusBadge>}
        </Field>
      </dl>
      <Switch checked={rule.enabled} aria-label={`启用 ${rule.label}`} onCheckedChange={(v) => void setTriggerEnabled(rule, v)} />
    </div>
  );
}

export interface ScheduleListProps {
  triggers: TriggerRule[];
  bots: Record<BotId, Bot>;
  devices: Record<string, Device>;
  events: HubEvent[];
  now: number;
  onEdit: (id: TriggerId) => void;
}

export function ScheduleList({ triggers, bots, devices, events, now, onEdit }: ScheduleListProps) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {triggers.map((t) => (
          <li key={t.id}>
            <ScheduleRow rule={t} bot={bots[t.targetBotId]} devices={devices} events={events} now={now} onEdit={onEdit} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
