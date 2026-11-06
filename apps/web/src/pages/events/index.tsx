import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Zap } from "lucide-react";
import type { EventSource, HubEvent, TriggerId } from "@muster/protocol";
import { Button, Card, Empty, Pebble, Section, cn } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";
import { Page, PageBody, PageHeader } from "../../components/layout";
import { HeaderTile } from "../../components/events/HeaderTile";
import { EventStatsRow } from "../../components/events/EventStats";
import { EventTimeline } from "../../components/events/EventTimeline";
import { SOURCE_LABEL, SourceIcon } from "../../components/events/SourceIcon";
import { TriggerList } from "../../components/events/TriggerList";
import { TriggerSheet } from "../../components/events/TriggerSheet";
import { computeEventStats } from "../../components/events/stats";
import { useNow } from "../../components/events/time";

type Filter = "all" | Exclude<EventSource, "system">;
const FILTERS: Filter[] = ["all", "user", "cron", "github", "callback", "device"];
const FRESH_WINDOW_MS = 5 * 60_000;
const FRESH_HIGHLIGHT_MS = 6_000;

function mergeSorted(...lists: HubEvent[][]): HubEvent[] {
  const byId = new Map<string, HubEvent>();
  for (const l of lists) for (const e of l) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export default function EventsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [fetched, setFetched] = useState<Partial<Record<Filter, HubEvent[]>>>({});
  const [sheet, setSheet] = useState<{ target: TriggerId | "new"; open: boolean; seq: number }>({ target: "new", open: false, seq: 0 });
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  const liveEvents = useHub((s) => s.model.events);
  const botMap = useHub((s) => s.model.bots);
  const triggerMap = useHub((s) => s.model.triggers);
  const deviceMap = useHub((s) => s.model.devices);
  const status = useHub((s) => s.status);
  const now = useNow();

  const bots = useMemo(() => Object.values(botMap), [botMap]);
  const devices = useMemo(() => Object.values(deviceMap), [deviceMap]);
  const triggers = useMemo(() => Object.values(triggerMap), [triggerMap]);

  // History for "all" (feeds the stats) and for the active filter; live pushes are merged in below.
  useEffect(() => {
    if (status !== "open") return;
    let alive = true;
    for (const f of new Set<Filter>(["all", filter])) {
      hubRequest("event.list", { source: f === "all" ? undefined : f, limit: 100 })
        .then((r) => alive && setFetched((cur) => ({ ...cur, [f]: r.events })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [filter, status]);

  // Events pushed while the page is open get a short entrance highlight.
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const ids = new Set(liveEvents.map((e) => e.id));
    const prev = seen.current;
    seen.current = ids;
    if (!prev) return;
    const added = liveEvents.filter((e) => !prev.has(e.id) && Date.now() - new Date(e.ts).getTime() < FRESH_WINDOW_MS).map((e) => e.id);
    if (added.length === 0) return;
    setFreshIds((cur) => new Set([...cur, ...added]));
    timers.current.push(
      setTimeout(() => {
        setFreshIds((cur) => {
          const next = new Set(cur);
          for (const id of added) next.delete(id);
          return next;
        });
      }, FRESH_HIGHLIGHT_MS),
    );
  }, [liveEvents]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const allEvents = useMemo(() => mergeSorted(fetched.all ?? [], liveEvents), [fetched.all, liveEvents]);
  const events = useMemo(
    () => (filter === "all" ? allEvents : mergeSorted(fetched[filter] ?? [], liveEvents.filter((e) => e.source === filter))),
    [allEvents, fetched, filter, liveEvents],
  );
  const stats = useMemo(() => computeEventStats(allEvents, triggers, now), [allEvents, triggers, now]);
  const countBy = useMemo(() => {
    const m: Partial<Record<Filter, number>> = { all: allEvents.length };
    for (const e of allEvents) m[e.source as Filter] = (m[e.source as Filter] ?? 0) + 1;
    return m;
  }, [allEvents]);

  const openSheet = (target: TriggerId | "new") => setSheet((s) => ({ target, open: true, seq: s.seq + 1 }));
  const editing = sheet.target === "new" ? undefined : triggerMap[sheet.target];

  return (
    <Page>
      <PageHeader
        title="事件"
        subtitle="一切皆为事件，Muster 与你同行"
        leading={<HeaderTile shape="round" color="cream" status={freshIds.size > 0 ? "working" : "idle"} />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openSheet("new")}>
            新建规则
          </Button>
        }
      />

      <EventStatsRow stats={stats} />

      <PageBody
        main={
          <section aria-label="事件流" className="min-w-0">
            <Section title="事件流" description="按时间倒序，点击一条可展开详情">
              <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="事件筛选">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={f === filter}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-pill px-4 text-sm font-medium outline-none transition-[background-color,color,box-shadow,transform] duration-200 ease-muster focus-visible:ring-4 focus-visible:ring-coral/20 active:scale-95",
                      f === filter ? "muster-gradient-brand text-white shadow-glow-coral" : "border border-line bg-surface text-ink-soft shadow-soft hover:-translate-y-px hover:text-ink",
                    )}
                  >
                    {f !== "all" && <SourceIcon source={f} size={16} />}
                    {f === "all" ? "全部" : SOURCE_LABEL[f]}
                    <span aria-hidden className={cn("text-xs tabular-nums", f === filter ? "text-white/80" : "text-ink-faint")}>{countBy[f] ?? 0}</span>
                  </button>
                ))}
              </div>
              <EventTimeline events={events} bots={botMap} triggers={triggerMap} now={now} freshIds={freshIds} />
            </Section>
          </section>
        }
        rail={
          <>
            <aside aria-label="触发规则" className="min-w-0 space-y-3.5">
              <Section
                title="触发规则"
                description={`${stats.triggerEnabled}/${stats.triggerTotal} 条已启用`}
                icon={<Zap className="size-[18px] text-coral" />}
                action={
                  <Button size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={() => openSheet("new")}>
                    新建
                  </Button>
                }
              >
                {triggers.length === 0 ? (
                  <Card className="border-dashed">
                    <Empty
                      compact
                      title="还没有触发规则"
                      description="让 PR、定时或设备上线自动把活儿交给合适的成员。"
                      pebble={{ shape: "round", color: "cream", status: "idle" }}
                      action={<Button variant="primary" size="sm" onClick={() => openSheet("new")}>创建第一条规则</Button>}
                    />
                  </Card>
                ) : (
                  <TriggerList triggers={triggers} bots={botMap} devices={deviceMap} now={now} onEdit={openSheet} />
                )}
              </Section>
            </aside>

            <Card frosted className="relative flex items-center gap-4 overflow-hidden p-5">
              <span aria-hidden className="muster-halo absolute -right-6 -top-6 size-32 rounded-full" style={{ ["--halo" as string]: "#ffb08f" }} />
              <Pebble shape="egg" color="peach" status="idle" size={72} halo className="relative shrink-0" />
              <p className="relative text-sm leading-relaxed text-ink-soft">
                每一个事件，
                <br />
                都是新的可能
              </p>
            </Card>
          </>
        }
      />

      <TriggerSheet
        key={sheet.seq}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        rule={editing}
        bots={bots}
        devices={devices}
      />
    </Page>
  );
}
