import { motion } from "motion/react";
import { Activity, Clock3, Sparkles, Workflow } from "lucide-react";
import type { EventSource } from "@muster/protocol";
import { Card, EASE, StatCard, Tooltip } from "@muster/ui";
import type { EventStats } from "./stats";
import { SOURCE_LABEL, SOURCE_STYLE } from "./SourceIcon";

const ORDER: EventSource[] = ["user", "cron", "github", "callback", "device", "system"];

/** Stacked bar of where the last 7 days of events came from. */
function SourceMix({ stats }: { stats: EventStats }) {
  const parts = ORDER.filter((s) => (stats.bySource[s] ?? 0) > 0);
  return (
    <Card className="relative overflow-hidden p-5" data-testid="source-mix">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lavender-soft text-lavender-deep [&_svg]:size-[18px]">
          <Workflow />
        </span>
        <span className="truncate text-sm font-medium text-ink-soft">来源分布</span>
        <span className="ml-auto text-xs text-ink-faint">近 7 天</span>
      </div>
      {stats.sourceTotal === 0 ? (
        <div className="mt-4 text-sm text-ink-faint">还没有事件，来源会在这里汇总</div>
      ) : (
        <>
          <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-pill bg-canvas-deep" role="img" aria-label="事件来源占比">
            {parts.map((s, i) => (
              <Tooltip key={s} content={`${SOURCE_LABEL[s]} ${stats.bySource[s]}`}>
                <motion.span
                  className="h-full min-w-1.5 rounded-pill"
                  style={{ background: SOURCE_STYLE[s].bar }}
                  initial={{ flexGrow: 0 }}
                  animate={{ flexGrow: stats.bySource[s] }}
                  transition={{ duration: 0.7, delay: i * 0.05, ease: EASE as unknown as [number, number, number, number] }}
                />
              </Tooltip>
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-ink-soft">
            {parts.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: SOURCE_STYLE[s].bar }} />
                {SOURCE_LABEL[s]}
                <span className="font-medium tabular-nums text-ink">{stats.bySource[s]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function EventStatsRow({ stats }: { stats: EventStats }) {
  return (
    <div className="muster-stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-5" data-testid="event-stats">
      <StatCard
        label="今日事件"
        value={stats.today}
        icon={<Activity />}
        tone="coral"
        sparkline={stats.daily}
        trend={stats.trend === undefined ? undefined : { value: Math.round(stats.trend), label: "较昨天" }}
        hint={stats.trend === undefined ? "近 7 天走势" : undefined}
      />
      <SourceMix stats={stats} />
      <StatCard label="触发规则" value={stats.triggerTotal} suffix=" 条" icon={<Clock3 />} tone="sky" hint={`${stats.triggerEnabled} 条已启用`} />
      <StatCard label="今日自动执行" value={stats.autoToday} suffix=" 次" icon={<Sparkles />} tone="mint" hint="自动模式规则的实际执行" />
    </div>
  );
}
