import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Bot, BotId, HubEvent, TriggerId, TriggerRule } from "@muster/protocol";
import { Badge, Chip, DescriptionList, EASE, Empty, Pebble, cn, type ChipTone } from "@muster/ui";
import { SourceIcon, SOURCE_LABEL, SOURCE_STYLE } from "./SourceIcon";
import { fullTime, groupByDay, relativeTime } from "./time";

const STATUS_LABEL: Record<NonNullable<HubEvent["status"]>, { label: string; tone: ChipTone }> = {
  recorded: { label: "已记录", tone: "neutral" },
  delivered: { label: "已送达", tone: "mint" },
  dispatched: { label: "已派发", tone: "sky" },
  ignored: { label: "已忽略", tone: "neutral" },
  failed: { label: "失败", tone: "danger" },
};

const EASE_T = EASE as unknown as [number, number, number, number];

interface ItemProps {
  event: HubEvent;
  bot?: Bot;
  trigger?: TriggerRule;
  now: number;
  fresh: boolean;
  index: number;
}

function EventItem({ event, bot, trigger, now, fresh, index }: ItemProps) {
  const [open, setOpen] = useState(false);
  const style = SOURCE_STYLE[event.source];
  const status = event.status ? STATUS_LABEL[event.status] : undefined;
  const panelId = `ev-detail-${event.id}`;
  return (
    <motion.li
      data-testid="event-item"
      data-fresh={fresh || undefined}
      className="relative flex gap-3.5 pb-4 last:pb-0"
      initial={fresh ? { opacity: 0, y: -18, scale: 0.97 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: fresh ? 0.5 : 0.32, delay: fresh ? 0 : Math.min(index, 10) * 0.03, ease: EASE_T }}
    >
      <span className={cn("relative z-10 mt-1 grid size-9 shrink-0 place-items-center rounded-full text-white shadow-soft ring-4 ring-surface-warm", style.dot, fresh && "muster-ping")}>
        <SourceIcon source={event.source} />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-card border border-white/70 shadow-soft transition-shadow duration-200 hover:shadow-lift",
          style.card,
          fresh && cn("ring-2", style.ring),
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer flex-col gap-2 rounded-card px-4 py-3 text-left outline-none focus-visible:ring-4 focus-visible:ring-coral/20"
        >
          <span className="flex items-start justify-between gap-3">
            <span className={cn("min-w-0 text-sm font-semibold", style.text)}>
              {event.title}
              {fresh && <Badge tone="coral" variant="solid" size="sm" className="ml-2 align-middle">新</Badge>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
              <time dateTime={event.ts} title={fullTime(event.ts)}>{relativeTime(event.ts, now)}</time>
              <ChevronDown aria-hidden className={cn("size-4 text-ink-faint transition-transform duration-200", open && "rotate-180")} />
            </span>
          </span>
          {(event.detail || status) && (
            <span className="flex flex-wrap items-center gap-2">
              {event.detail && (
                <span className="inline-flex items-center gap-2 rounded-pill bg-surface/80 py-1 pl-1 pr-3 text-sm text-ink shadow-soft">
                  {bot && <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={26} lite title={bot.name} />}
                  {event.detail}
                </span>
              )}
              {status && <Badge tone={status.tone} dot>{status.label}</Badge>}
            </span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE_T }}
              className="overflow-hidden"
            >
              <div className="mx-4 border-t border-line/80 pb-4 pt-3">
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "发生时间", value: fullTime(event.ts) },
                    { label: "来源", value: <Chip tone="neutral">{SOURCE_LABEL[event.source]}</Chip> },
                    ...(trigger ? [{ label: "触发规则", value: trigger.label }] : []),
                    ...(bot ? [{ label: "处理成员", value: bot.name }] : []),
                    { label: "事件 ID", value: event.id, mono: true, copyable: true },
                  ]}
                />
                {event.taskId && (
                  <Link
                    to={`/task/${event.taskId}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-coral-deep hover:underline"
                  >
                    查看关联任务 <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

export interface EventTimelineProps {
  events: HubEvent[];
  bots: Record<BotId, Bot>;
  triggers?: Record<TriggerId, TriggerRule>;
  now: number;
  /** Ids that just arrived live: they get the entrance highlight. */
  freshIds?: ReadonlySet<string>;
}

export function EventTimeline({ events, bots, triggers, now, freshIds }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60">
        <Empty
          compact
          title="这个分类下还没有事件"
          description="定时、GitHub、设备上线和你的每一次插话，都会在这里留下一条记录。"
          pebble={{ shape: "egg", color: "sky", status: "sleeping" }}
        />
      </div>
    );
  }
  let index = 0;
  return (
    <div className="space-y-6">
      {groupByDay(events, now).map((g) => (
        <section key={g.key} aria-label={g.label} data-testid="event-day">
          <div className="sticky top-0 z-20 -mx-1 mb-3 flex items-center gap-3 bg-gradient-to-b from-canvas via-canvas/90 to-transparent px-1 py-1.5">
            <h3 className="text-sm font-semibold text-ink">{g.label}</h3>
            <Chip tone="neutral" className="tabular-nums">{g.items.length} 条</Chip>
            <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
          </div>
          <ol className="relative">
            <span aria-hidden className="absolute bottom-3 left-[17px] top-5 w-px bg-gradient-to-b from-line via-line to-transparent" />
            {g.items.map((e) => (
              <EventItem
                key={e.id}
                event={e}
                bot={e.botId ? bots[e.botId] : undefined}
                trigger={e.triggerId ? triggers?.[e.triggerId] : undefined}
                now={now}
                fresh={freshIds?.has(e.id) ?? false}
                index={index++}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
