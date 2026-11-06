import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown, MessageSquare } from "lucide-react";
import type { Bot, BotId, HubEvent, Task, TaskId } from "@muster/protocol";
import { Badge, Button, Card, EmptyState, StatusBadge, cn } from "@muster/ui";
import { MemberAvatar } from "../common";
import { continueTarget, foldEvents, type FeedItem } from "./feed";
import { EVENT_STATUS } from "./meta";
import { SOURCE_LABEL, SourceIcon } from "./SourceIcon";
import { clock, fullTime, groupByDay } from "./time";

interface Lookup {
  bots: Record<BotId, Bot>;
  tasks: Record<TaskId, Task>;
}

function SourceTile({ source }: { source: HubEvent["source"] }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-fg-2">
      <SourceIcon source={source} />
    </span>
  );
}

function EventRow({ event, bots, tasks, compact }: Lookup & { event: HubEvent; compact?: boolean }) {
  const bot = event.botId ? bots[event.botId] : undefined;
  const task = event.taskId ? tasks[event.taskId] : undefined;
  const status = event.status ? EVENT_STATUS[event.status] : undefined;
  const target = continueTarget(event, bots, tasks);
  return (
    <div data-testid="event-item" className="flex gap-3">
      {!compact && <SourceTile source={event.source} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-body font-medium text-fg">{event.title}</p>
          <time dateTime={event.ts} title={fullTime(event.ts)} className="shrink-0 pt-0.5 text-caption tabular-nums text-fg-3">
            {clock(event.ts)}
          </time>
        </div>
        {event.detail && <p className="mt-0.5 text-sm text-fg-2">{event.detail}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-2">
          <span>{SOURCE_LABEL[event.source]}</span>
          {bot && (
            <span className="inline-flex items-center gap-1.5">
              <MemberAvatar bot={bot} size={24} />
              {bot.name}
            </span>
          )}
          {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
          {task && (
            <Link to={`/task/${task.id}`} className="min-w-0 truncate text-accent underline-offset-2 hover:underline">
              来源任务：{task.title}
            </Link>
          )}
          {target && (
            <Link to={target} className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline">
              <MessageSquare className="size-3.5" aria-hidden />
              继续对话
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRun({ events, bots, tasks }: Lookup & { events: HubEvent[] }) {
  const [open, setOpen] = useState(false);
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const failed = events.filter((e) => e.status === "failed").length;
  const panelId = `ev-run-${first.id}`;
  return (
    <div data-testid="event-run" className="flex gap-3">
      <SourceTile source={first.source} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-body font-medium text-fg">{first.title}</p>
          <time className="shrink-0 pt-0.5 text-caption tabular-nums text-fg-3">
            {clock(last.ts)}–{clock(first.ts)}
          </time>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-2">
          <span>{SOURCE_LABEL[first.source]}</span>
          <Badge>{`共 ${events.length} 次`}</Badge>
          {failed > 0 && <StatusBadge tone="danger">{`${failed} 次失败`}</StatusBadge>}
          <Button variant="ghost" size="sm" className="-my-1" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} icon={<ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />}>
            {open ? "收起" : "展开全部"}
          </Button>
        </div>
        {open && (
          <ul id={panelId} className="mt-3 space-y-3 border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id}>
                <EventRow event={e} bots={bots} tasks={tasks} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeedRow({ item, bots, tasks }: Lookup & { item: FeedItem }) {
  return item.kind === "run" ? <EventRun events={item.events} bots={bots} tasks={tasks} /> : <EventRow event={item.event} bots={bots} tasks={tasks} />;
}

export interface EventTimelineProps extends Lookup {
  events: HubEvent[];
  now: number;
}

/** Day-grouped feed (今天 / 昨天 / date). Look-alike events in a row fold into one expandable item. */
export function EventTimeline({ events, bots, tasks, now }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <Card>
        <EmptyState compact title="还没有事件" description="定时、GitHub、设备上线和你的每一次插话，都会在这里留下一条记录。" />
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {groupByDay(events, now).map((g) => (
        <section key={g.key} aria-label={g.label} data-testid="event-day">
          <h3 className="mb-2 text-sm font-semibold text-fg">{g.label}</h3>
          <Card>
            <ul className="divide-y divide-border">
              {foldEvents(g.items).map((item) => (
                <li key={item.kind === "run" ? item.key : item.event.id} className="px-4 py-3.5">
                  <FeedRow item={item} bots={bots} tasks={tasks} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
