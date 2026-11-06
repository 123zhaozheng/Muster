import { useState } from "react";
import { Play } from "lucide-react";
import type { Bot, BotId, Device, TriggerId, TriggerRule } from "@muster/protocol";
import { Badge, Button, Card, Pebble, Switch, cn } from "@muster/ui";
import { fireTrigger, setTriggerEnabled } from "./actions";
import { formatFireTime, nextFireOf } from "./cron";
import { GITHUB_EVENTS, MODE_LABEL, MODE_META } from "./meta";
import { SOURCE_LABEL, SOURCE_STYLE, SourceIcon } from "./SourceIcon";
import { relativeTime } from "./time";

/** One-line description of what makes the rule fire. */
export function paramSummary(t: TriggerRule, devices: Record<string, Device>): string {
  const p = t.params;
  if (t.source === "github") {
    const ev = GITHUB_EVENTS.find((e) => e.value === p.event)?.label ?? p.event ?? "";
    return [p.repo, ev].filter(Boolean).join(" · ");
  }
  if (t.source === "cron") return [p.expr, p.tz].filter(Boolean).join(" · ");
  if (t.source === "device") return devices[p.deviceId ?? ""]?.name ?? "指定设备上线";
  return "子成员完成任务时";
}

function nextLabel(t: TriggerRule, now: number): string {
  if (!t.enabled) return "已停用";
  if (t.source === "cron") {
    const next = nextFireOf(t, new Date(now));
    return next ? formatFireTime(next, t.params.tz, new Date(now)) : "表达式无效";
  }
  return "有事件时触发";
}

function TriggerCard({ t, bot, devices, now, onEdit }: { t: TriggerRule; bot?: Bot; devices: Record<string, Device>; now: number; onEdit: (id: TriggerId) => void }) {
  const [firing, setFiring] = useState(false);
  const style = SOURCE_STYLE[t.source];
  const mode = MODE_META[t.mode];
  return (
    <Card
      hoverable
      data-testid="trigger-card"
      onClick={() => onEdit(t.id)}
      className={cn("p-4 transition-opacity", !t.enabled && "opacity-70")}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", style.card, style.text)}>
          <SourceIcon source={t.source} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-label={`编辑规则 ${t.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(t.id);
            }}
            className="block max-w-full cursor-pointer truncate rounded-md text-left text-sm font-semibold text-ink outline-none hover:text-coral-deep focus-visible:ring-4 focus-visible:ring-coral/20"
          >
            {t.label}
          </button>
          <div className="mt-0.5 truncate text-xs text-ink-faint" title={paramSummary(t, devices)}>
            {SOURCE_LABEL[t.source]} · {paramSummary(t, devices)}
          </div>
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <Switch checked={t.enabled} aria-label={`启用 ${t.label}`} onCheckedChange={(v) => void setTriggerEnabled(t, v)} />
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {bot ? <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={26} lite title={bot.name} /> : <span className="size-[26px] rounded-full bg-canvas-deep" />}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">交给 {bot?.name ?? "未知成员"}</span>
        <Badge tone={mode.tone} size="sm" icon={<span className="[&_svg]:size-3">{mode.icon}</span>}>{MODE_LABEL[t.mode]}</Badge>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-line/80 pt-3">
        <dl className="grid grid-cols-2 gap-x-5 text-xs">
          <div>
            <dt className="text-ink-faint">上次触发</dt>
            <dd className="mt-0.5 text-ink-soft">{t.lastFiredAt ? relativeTime(t.lastFiredAt, now) : "尚未触发"}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">下次触发</dt>
            <dd className="mt-0.5 text-ink-soft">{nextLabel(t, now)}</dd>
          </div>
        </dl>
        <Button
          size="sm"
          variant="soft"
          icon={<Play className="size-3.5" />}
          loading={firing}
          aria-label={`试跑 ${t.label}`}
          onClick={(e) => {
            e.stopPropagation();
            setFiring(true);
            void fireTrigger(t).finally(() => setFiring(false));
          }}
        >
          试跑
        </Button>
      </div>
    </Card>
  );
}

export interface TriggerListProps {
  triggers: TriggerRule[];
  bots: Record<BotId, Bot>;
  devices: Record<string, Device>;
  now: number;
  onEdit: (id: TriggerId) => void;
}

export function TriggerList({ triggers, bots, devices, now, onEdit }: TriggerListProps) {
  return (
    <ul className="muster-stagger space-y-3">
      {triggers.map((t) => (
        <li key={t.id}>
          <TriggerCard t={t} bot={bots[t.targetBotId]} devices={devices} now={now} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}
