import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Coins, Download, Gauge, ListChecks, Search, Wallet } from "lucide-react";
import type { Bot, EventSource, HubEvent, TaskStatus } from "@muster/protocol";
import { Badge, Button, Card, Empty, Input, Pebble, Section, StatCard, cn, type ChipTone } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { relativeTime } from "../../lib/format";
import { exportEventsJson, tokensText, usd } from "./format";

const TASK_STATUS: Record<TaskStatus, [string, ChipTone]> = {
  queued: ["排队中", "neutral"],
  running: ["进行中", "mint"],
  waiting_approval: ["等待审批", "amber"],
  done: ["已完成", "mint"],
  failed: ["失败", "danger"],
  cancelled: ["已取消", "neutral"],
};

const SOURCE_LABEL: Record<EventSource, string> = { user: "你", cron: "定时", github: "GitHub", callback: "回调", device: "设备", system: "系统" };
const SOURCE_TONE: Record<EventSource, ChipTone> = { user: "coral", cron: "lavender", github: "sky", callback: "mint", device: "amber", system: "neutral" };
const SOURCES = Object.keys(SOURCE_LABEL) as EventSource[];

/** 图表用色（品牌色序列），按 Bot 排名循环取用。 */
export const SERIES_COLORS = ["#ff6b4a", "#8b7cf6", "#34c58a", "#5aa9f5", "#f5a524", "#e5484d"] as const;

/* ───────── 概览统计 ───────── */

export function CostSummary() {
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  const stats = useMemo(() => {
    const taskList = Object.values(tasks);
    const withCost = taskList.filter((t) => t.costUsd !== undefined);
    const taskUsd = withCost.reduce((n, t) => n + (t.costUsd ?? 0), 0);
    return {
      weekUsd: Object.values(bots).reduce((n, b) => n + b.costWeekUsd, 0),
      tokens: taskList.reduce((n, t) => n + (t.tokens ?? 0), 0),
      taskCount: taskList.length,
      avgUsd: withCost.length > 0 ? taskUsd / withCost.length : 0,
      costedCount: withCost.length,
    };
  }, [bots, tasks]);
  return (
    <div className="muster-stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="本周总花费" value={stats.weekUsd} format={usd} icon={<Wallet />} tone="coral" hint="所有 Bot 合计" />
      <StatCard label="Token 总量" value={stats.tokens} format={tokensText} icon={<Coins />} tone="lavender" hint="已统计任务的输入加输出" />
      <StatCard label="任务数" value={stats.taskCount} icon={<ListChecks />} tone="mint" hint={`其中 ${stats.costedCount} 个有花费数据`} />
      <StatCard label="平均每任务" value={stats.avgUsd} format={usd} icon={<Gauge />} tone="sky" hint="按有花费数据的任务计算" />
    </div>
  );
}

/* ───────── 按 Bot 的横向条形图 ───────── */

export function useBotCosts() {
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  return useMemo(() => {
    const tokensByBot: Record<string, number> = {};
    const countByBot: Record<string, number> = {};
    for (const t of Object.values(tasks)) {
      tokensByBot[t.botId] = (tokensByBot[t.botId] ?? 0) + (t.tokens ?? 0);
      countByBot[t.botId] = (countByBot[t.botId] ?? 0) + 1;
    }
    const list = Object.values(bots)
      .sort((a, b) => b.costWeekUsd - a.costWeekUsd)
      .map((b, i) => ({ bot: b, usd: b.costWeekUsd, tokens: tokensByBot[b.id] ?? 0, tasks: countByBot[b.id] ?? 0, color: SERIES_COLORS[i % SERIES_COLORS.length]! }));
    const total = list.reduce((n, r) => n + r.usd, 0);
    return { list, total };
  }, [bots, tasks]);
}

/** 挂载后从 0 长到目标宽度；之后数据变化平滑过渡。 */
function GrowBar({ pct, color }: { pct: number; color: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className="h-full rounded-pill transition-[width] duration-700 ease-muster"
      style={{ width: on ? `${pct}%` : "0%", background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
    />
  );
}

/** 列表里的小头像：只保留呼吸和眨眼，省性能。 */
function MiniBot({ bot, size }: { bot: Pick<Bot, "shape" | "color" | "status" | "name">; size: number }) {
  return <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={size} title={bot.name} lite interactive={false} />;
}

export function BotCostList() {
  const { list, total } = useBotCosts();
  const max = Math.max(0.01, ...list.map((r) => r.usd));
  return (
    <Section title="本周各 Bot 花费" description="按花费从高到低排序，条长为相对最高者的比例。" card>
      {list.length === 0 ? (
        <Empty compact title="还没有 Bot" description="添加成员并派发任务后，这里会按成员显示花费。" pebble={{ status: "sleeping" }} />
      ) : (
        <ul className="grid gap-4">
          {list.map((r) => (
            <li key={r.bot.id} className="flex items-center gap-4" data-testid="bot-cost-row">
              <MiniBot bot={r.bot} size={40} />
              <div className="w-28 shrink-0">
                <div className="truncate text-sm font-medium text-ink">{r.bot.name}</div>
                <div className="truncate text-xs text-ink-faint">{r.bot.engineLabel}</div>
              </div>
              <div className="relative h-3 flex-1 overflow-hidden rounded-pill bg-canvas-deep shadow-[inset_0_1px_2px_rgb(60_40_20/0.06)]" role="img" aria-label={`${r.bot.name} 占比 ${total > 0 ? Math.round((r.usd / total) * 100) : 0}%`}>
                <GrowBar pct={(r.usd / max) * 100} color={r.color} />
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-ink">{usd(r.usd)}</div>
                <div className="text-xs tabular-nums text-ink-faint">{total > 0 ? Math.round((r.usd / total) * 100) : 0}% · {r.tasks} 个任务</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ───────── 占比环形图（右栏） ───────── */

export function CostDonut() {
  const { list, total } = useBotCosts();
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Card className="muster-glass-2 p-5">
      <h3 className="text-[15px] font-semibold text-ink">花费占比</h3>
      {total <= 0 ? (
        <p className="mt-3 text-sm text-ink-soft">本周还没有花费，Bot 开始工作后这里会出现占比。</p>
      ) : (
        <div className="mt-4 flex items-center gap-5">
          <svg viewBox="0 0 140 140" className="size-32 shrink-0" role="img" aria-label="各 Bot 花费占比环形图">
            <g transform="rotate(-90 70 70)">
              <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-canvas-deep)" strokeWidth="16" />
              {list.filter((r) => r.usd > 0).map((r) => {
                const len = (r.usd / total) * C;
                const dash = Math.max(0, len - 2);
                const seg = (
                  <circle
                    key={r.bot.id}
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={r.color}
                    strokeWidth="16"
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="round"
                    className="transition-[stroke-dasharray] duration-700 ease-muster"
                  />
                );
                offset += len;
                return seg;
              })}
            </g>
            <text x="70" y="66" textAnchor="middle" className="fill-ink-faint text-[11px]">本周</text>
            <text x="70" y="84" textAnchor="middle" className="fill-ink text-[15px] font-semibold">{list.filter((r) => r.usd > 0).length} 位成员</text>
          </svg>
          <ul className="grid min-w-0 flex-1 gap-1.5">
            {list.filter((r) => r.usd > 0).map((r) => (
              <li key={r.bot.id} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-soft">{r.bot.name}</span>
                <span className="tabular-nums text-ink">{Math.round((r.usd / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ───────── 任务明细（可排序） ───────── */

type SortKey = "startedAt" | "title" | "tokens" | "costUsd";

export function TaskCostTable() {
  const tasks = useHub((s) => s.model.tasks);
  const bots = useHub((s) => s.model.bots);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "startedAt", dir: "desc" });
  const list = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return Object.values(tasks).sort((a, b) => {
      if (sort.key === "title") return a.title.localeCompare(b.title, "zh-CN") * sign;
      if (sort.key === "startedAt") return (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0) * sign;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1; // 没数据的永远排最后
      if (bv === undefined) return -1;
      return (av - bv) * sign;
    });
  }, [tasks, sort]);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "title" ? "asc" : "desc" }));

  const Th = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("py-2.5 font-medium", right ? "text-right" : "text-left")}>
        <button
          type="button"
          onClick={() => toggle(k)}
          className={cn("inline-flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-canvas-deep hover:text-ink", active && "text-coral-deep")}
        >
          {children}
          <Icon className={cn("size-3.5", !active && "opacity-40")} />
        </button>
      </th>
    );
  };

  return (
    <Section title="任务明细" description="tokens 与花费由各驱动上报，暂无数据时显示 —。点表头可排序。" card bodyClassName="p-0 overflow-hidden">
      {list.length === 0 ? (
        <Empty compact title="还没有任务" description="派发任务后，这里会显示每个任务的 tokens 与花费。" pebble={{ status: "sleeping" }} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-canvas-deep/50 text-xs text-ink-soft">
              <tr>
                <Th k="title">任务</Th>
                <th scope="col" className="py-2.5 text-left font-medium">Bot</th>
                <th scope="col" className="py-2.5 text-left font-medium">状态</th>
                <Th k="startedAt">开始</Th>
                <Th k="tokens" right>tokens</Th>
                <Th k="costUsd" right>花费</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const [label, tone] = TASK_STATUS[t.status];
                const bot = bots[t.botId];
                return (
                  <tr key={t.id} className="border-t border-line/60 transition-colors hover:bg-coral-soft/30">
                    <td className="max-w-72 truncate py-3 pl-5 font-medium text-ink">{t.title}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-2 text-ink-soft">
                        {bot && <MiniBot bot={bot} size={22} />}
                        {bot?.name ?? t.botId}
                      </span>
                    </td>
                    <td className="py-3"><Badge tone={tone} dot>{label}</Badge></td>
                    <td className="py-3 text-ink-faint">{relativeTime(t.startedAt)}</td>
                    <td className="py-3 text-right tabular-nums">{tokensText(t.tokens)}</td>
                    <td className="py-3 pr-5 text-right font-medium tabular-nums">{usd(t.costUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ───────── 审计日志 ───────── */

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const PAGE_SIZE = 20;

export function AuditLog() {
  const events = useHub((s) => s.model.events);
  const bots = useHub((s) => s.model.bots);
  const [source, setSource] = useState<EventSource | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e: HubEvent) => (source === "all" || e.source === source) && (!q || `${e.title} ${e.detail ?? ""}`.toLowerCase().includes(q)));
  }, [events, source, query]);
  return (
    <Section
      title="审计日志"
      description={`事件中心的全部记录，当前已加载 ${events.length} 条。`}
      actions={
        <Button size="sm" variant="outline" icon={<Download className="size-4" />} disabled={shown.length === 0} onClick={() => exportEventsJson(shown)}>
          导出 JSON
        </Button>
      }
      card
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="按来源筛选">
          {(["all", ...SOURCES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => { setSource(s); setLimit(PAGE_SIZE); }}
              className={cn(
                "cursor-pointer rounded-pill border px-3 py-1 text-sm transition-[background-color,color,border-color] duration-200 ease-muster active:scale-[0.97]",
                source === s ? "border-coral/40 bg-coral-soft font-medium text-coral-deep" : "border-line bg-surface text-ink-soft hover:text-ink",
              )}
            >
              {s === "all" ? "全部" : SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }} placeholder="搜索标题或详情" aria-label="搜索审计日志" className="pl-9" />
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty compact title="没有符合条件的记录" description="换个来源或关键词试试。" pebble={{ status: "sleeping" }} />
      ) : (
        <>
          <ul className="divide-y divide-line/60">
            {shown.slice(0, limit).map((e) => {
              const bot = e.botId ? bots[e.botId] : undefined;
              return (
                <li key={e.id} className="flex items-start gap-3 py-3">
                  <Badge tone={SOURCE_TONE[e.source]} className="mt-0.5 shrink-0">{SOURCE_LABEL[e.source]}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{e.title}</div>
                    {e.detail && <div className="truncate text-xs text-ink-soft">{e.detail}</div>}
                  </div>
                  {bot && <span className="hidden shrink-0 items-center gap-1.5 text-xs text-ink-faint sm:inline-flex"><MiniBot bot={bot} size={20} />{bot.name}</span>}
                  <time className="w-28 shrink-0 text-right text-xs tabular-nums text-ink-faint" dateTime={e.ts}>{fmtTime(e.ts)}</time>
                </li>
              );
            })}
          </ul>
          {shown.length > limit && (
            <div className="mt-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>显示更多（还有 {shown.length - limit} 条）</Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/* ───────── 最贵的任务（右栏） ───────── */

export function TopTasks() {
  const tasks = useHub((s) => s.model.tasks);
  const top = useMemo(
    () => Object.values(tasks).filter((t) => t.costUsd !== undefined).sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)).slice(0, 3),
    [tasks],
  );
  const max = Math.max(0.01, ...top.map((t) => t.costUsd ?? 0));
  return (
    <Card className="muster-glass-2 p-5">
      <h3 className="text-[15px] font-semibold text-ink">花费最高的任务</h3>
      {top.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">还没有带花费数据的任务。</p>
      ) : (
        <ol className="mt-3 grid gap-3.5">
          {top.map((t, i) => (
            <li key={t.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink"><span className="mr-1.5 text-ink-faint tabular-nums">{i + 1}</span>{t.title}</span>
                <span className="shrink-0 font-medium tabular-nums">{usd(t.costUsd)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-canvas-deep">
                <div className="h-full rounded-pill bg-coral/80" style={{ width: `${((t.costUsd ?? 0) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
