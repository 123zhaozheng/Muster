import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { EventSource, HubEvent, TriggerId } from "@muster/protocol";
import { Button, Card, EmptyState, PageHeader, Section, Select, Tabs, TabsContent, TabsList, TabsTrigger } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";
import { Page, PageBody } from "../../components/layout";
import { MemberAvatar } from "../../components/common";
import { EventTimeline } from "../../components/events/EventTimeline";
import { ScheduleList } from "../../components/events/ScheduleList";
import { SOURCE_LABEL } from "../../components/events/SourceIcon";
import { TriggerSheet } from "../../components/events/TriggerSheet";
import { upcomingRuns } from "../../components/events/schedule";
import { useNow } from "../../shell/useNow";

type Filter = "all" | Exclude<EventSource, "system">;
const FILTERS: Filter[] = ["all", "user", "cron", "github", "callback", "device"];
const FILTER_OPTIONS = FILTERS.map((f) => ({ value: f, label: f === "all" ? "全部来源" : SOURCE_LABEL[f] }));

function mergeSorted(...lists: HubEvent[][]): HubEvent[] {
  const byId = new Map<string, HubEvent>();
  for (const l of lists) for (const e of l) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export default function EventsPage() {
  const [tab, setTab] = useState("feed");
  const [filter, setFilter] = useState<Filter>("all");
  const [fetched, setFetched] = useState<Partial<Record<Filter, HubEvent[]>>>({});
  const [sheet, setSheet] = useState<{ target: TriggerId | "new"; open: boolean; seq: number }>({ target: "new", open: false, seq: 0 });

  const liveEvents = useHub((s) => s.model.events);
  const botMap = useHub((s) => s.model.bots);
  const taskMap = useHub((s) => s.model.tasks);
  const triggerMap = useHub((s) => s.model.triggers);
  const deviceMap = useHub((s) => s.model.devices);
  const status = useHub((s) => s.status);
  const now = useNow();

  const bots = useMemo(() => Object.values(botMap), [botMap]);
  const devices = useMemo(() => Object.values(deviceMap), [deviceMap]);
  const triggers = useMemo(() => Object.values(triggerMap), [triggerMap]);

  // History for the active filter; live pushes are merged in below.
  useEffect(() => {
    if (status !== "open") return;
    let alive = true;
    hubRequest("event.list", { source: filter === "all" ? undefined : filter, limit: 100 })
      .then((r) => alive && setFetched((cur) => ({ ...cur, [filter]: r.events })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [filter, status]);

  const events = useMemo(
    () => mergeSorted(fetched[filter] ?? [], filter === "all" ? liveEvents : liveEvents.filter((e) => e.source === filter)),
    [fetched, filter, liveEvents],
  );
  const allEvents = useMemo(() => mergeSorted(fetched.all ?? [], liveEvents), [fetched.all, liveEvents]);
  const upcoming = useMemo(() => upcomingRuns(triggers, now), [triggers, now]);

  const openSheet = (target: TriggerId | "new") => setSheet((s) => ({ target, open: true, seq: s.seq + 1 }));
  const editing = sheet.target === "new" ? undefined : triggerMap[sheet.target];

  return (
    <Page>
      <PageHeader
        title="事件"
        subtitle="发生过的事，和即将要做的事"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openSheet("new")}>
            新建日程
          </Button>
        }
      />

      <PageBody
        railClassName="hidden @5xl:grid"
        main={
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="事件视图">
              <TabsTrigger value="feed">动态</TabsTrigger>
              <TabsTrigger value="schedule">日程</TabsTrigger>
            </TabsList>

            <TabsContent value="feed" className="mt-5 space-y-4">
              <div className="flex items-center justify-end">
                <Select size="sm" aria-label="按来源筛选" className="w-36" value={filter} onValueChange={(v) => setFilter(v as Filter)} options={FILTER_OPTIONS} />
              </div>
              <EventTimeline events={events} bots={botMap} tasks={taskMap} now={now} />
            </TabsContent>

            <TabsContent value="schedule" className="mt-5">
              {triggers.length === 0 ? (
                <Card>
                  <EmptyState
                    compact
                    title="还没有日程"
                    description="让定时、PR 或设备上线自动把活儿交给合适的成员。"
                    action={<Button variant="primary" size="sm" onClick={() => openSheet("new")}>创建第一条日程</Button>}
                  />
                </Card>
              ) : (
                <ScheduleList triggers={triggers} bots={botMap} devices={deviceMap} events={allEvents} now={now} onEdit={openSheet} />
              )}
            </TabsContent>
          </Tabs>
        }
        rail={
          <Section title="即将到来" description="按下一次运行时间排序">
            {upcoming.length === 0 ? (
              <Card className="px-4 py-5 text-sm text-fg-2">没有已启用的定时日程。</Card>
            ) : (
              <Card>
                <ul className="divide-y divide-border">
                  {upcoming.map(({ trigger, run }) => {
                    const bot = botMap[trigger.targetBotId];
                    return (
                      <li key={trigger.id} data-testid="upcoming-item" className="flex items-start gap-3 px-4 py-3">
                        {bot && <MemberAvatar bot={bot} size={28} />}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">{trigger.label}</p>
                          <p className="mt-0.5 text-caption text-fg-2">{run.text}</p>
                          <p className="text-caption text-fg-3">{run.tz}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </Section>
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
