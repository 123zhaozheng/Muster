import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CalendarClock, ChevronRight, Laptop, Monitor, Server, ShieldAlert, Users, Zap, type LucideIcon } from "lucide-react";
import type { Bot, Device, Task, TriggerRule } from "@muster/protocol";
import { Badge, Button, Dot, Pebble, ProgressBar, cn, type ChipTone } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { ApprovalCard } from "../ApprovalCard";
import { ACTIVE_STATUSES, TASK_STATUS, taskPercent } from "./DispatchCard";
import { nextDailyRun, relativeAgo } from "./time";

const TILE: Partial<Record<ChipTone, string>> = {
  coral: "bg-coral-soft text-coral-deep",
  mint: "bg-mint-soft text-mint-deep",
  sky: "bg-sky-soft text-sky-deep",
  lavender: "bg-lavender-soft text-lavender-deep",
  amber: "bg-amber-soft text-amber-deep",
};
const MAX_ROWS = 5;

/** 右栏区块：图标 + 标题 + 计数 + “查看全部”。 */
function RailSection({ icon: Icon, tone, title, count, to, children }: { icon: LucideIcon; tone: ChipTone; title: string; count?: ReactNode; to?: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <section role="region" aria-label={title} className="muster-glass-2 rounded-card p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", TILE[tone])}><Icon className="size-[17px]" aria-hidden /></span>
        <h2 className="flex-1 text-[17px] font-semibold leading-6">{title}</h2>
        {count !== undefined && count !== 0 && <Badge tone={tone === "mint" ? "mint" : "coral"} size="sm" className="tabular-nums">{count}</Badge>}
        {to && (
          <Button variant="ghost" size="sm" className="-mr-2 h-7 gap-0.5 px-2 text-xs" aria-label={`查看全部${title}`} onClick={() => navigate(to)}>
            查看全部<ChevronRight className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function RailEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-canvas-deep/50 px-3 py-3 text-sm text-ink-soft">
      <Pebble status="sleeping" size={32} lite interactive={false} />
      <span>{children}</span>
    </div>
  );
}

const rowBtn = "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-canvas-deep/70 focus-visible:ring-2 focus-visible:ring-coral/50";

function ActiveTasks({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const bots = useHub((s) => s.model.bots);
  return (
    <RailSection icon={Zap} tone="amber" title="进行中" count={tasks.length} to={tasks.length ? "/events" : undefined}>
      {tasks.length === 0 ? (
        <RailEmpty>暂时没有进行中的任务，跟 Pip 说一声就开工。</RailEmpty>
      ) : (
        <ul className="-mx-2">
          {tasks.slice(0, MAX_ROWS).map((t) => {
            const bot = bots[t.botId];
            const st = TASK_STATUS[t.status];
            const pct = taskPercent(t);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => navigate(`/task/${t.id}`)} className={rowBtn}>
                  {bot && <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={38} title={bot.name} lite interactive={false} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <ProgressBar size="sm" value={pct ?? 0} tone={st.bar} indeterminate={pct === undefined && t.status === "running"} label={`${t.title} 进度`} className="flex-1" />
                      <span className="shrink-0 text-xs tabular-nums text-ink-soft">{st.label}{pct !== undefined && ` · ${Math.round(pct)}%`}</span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

function NeedsYou() {
  const approvals = useHub((s) => s.model.approvals);
  const pending = useMemo(() => Object.values(approvals).filter((a) => a.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [approvals]);
  return (
    <RailSection icon={ShieldAlert} tone="amber" title="需要你" count={pending.length} to={pending.length ? "/inbox" : undefined}>
      {pending.length === 0 ? (
        <RailEmpty>没有等你处理的事，放心。</RailEmpty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {pending.slice(0, 3).map((a) => <ApprovalCard key={a.id} approval={a} compact className="border-amber/30 bg-surface/80 shadow-none" />)}
        </div>
      )}
    </RailSection>
  );
}

function scheduleText(t: TriggerRule, now: number): { next: string | null; last: string } {
  const next = t.enabled && t.source === "cron" ? nextDailyRun(t.params.expr ?? "", t.params.tz, now) : null;
  return { next, last: t.lastFiredAt ? `上次 ${relativeAgo(t.lastFiredAt, now)}` : "尚未触发" };
}

function Schedule({ triggers, now }: { triggers: TriggerRule[]; now: number }) {
  const navigate = useNavigate();
  return (
    <RailSection icon={CalendarClock} tone="lavender" title="日程" count={triggers.length} to={triggers.length ? "/events" : undefined}>
      {triggers.length === 0 ? (
        <RailEmpty>还没有定时任务。</RailEmpty>
      ) : (
        <ul className="-mx-2">
          {triggers.slice(0, MAX_ROWS).map((t) => {
            const { next, last } = scheduleText(t, now);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => navigate("/events")} className={cn(rowBtn, !t.enabled && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.label}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-soft">{t.enabled ? last : "已停用"}</div>
                  </div>
                  {next && <Badge tone="lavender" size="sm" className="shrink-0 tabular-nums">下次 {next}</Badge>}
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

function Team({ members }: { members: Bot[] }) {
  const navigate = useNavigate();
  const online = members.filter((b) => b.status !== "sleeping").length;
  return (
    <RailSection icon={Users} tone="sky" title="团队在线" count={members.length ? `${online}/${members.length}` : undefined} to={members.length ? "/crew" : undefined}>
      {members.length === 0 ? (
        <RailEmpty>还没有成员，去团队页添加一位吧。</RailEmpty>
      ) : (
        <div className="grid grid-cols-4 gap-x-2 gap-y-3">
          {members.slice(0, 8).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => navigate("/crew")}
              title={`${b.name} · ${b.statusDetail ?? b.engineLabel}`}
              className="group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-1.5 outline-none transition-colors hover:bg-canvas-deep/70 focus-visible:ring-2 focus-visible:ring-coral/50"
            >
              <span className="relative grid size-12 place-items-center transition-transform duration-200 ease-muster group-hover:-translate-y-0.5">
                <Pebble shape={b.shape} color={b.color} status={b.status} size={46} lite interactive={false} />
                <Dot status={b.status} size={10} pulse={b.status === "working" || b.status === "waiting_approval"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" aria-hidden />
              </span>
              <span className="max-w-full truncate text-xs font-medium">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </RailSection>
  );
}

const OS_ICON = { windows: Monitor, macos: Laptop, linux: Server } as const;

function Devices({ devices }: { devices: Device[] }) {
  const navigate = useNavigate();
  const online = devices.filter((d) => d.online).length;
  return (
    <RailSection icon={Laptop} tone="mint" title="已连接电脑" count={devices.length ? `${online}/${devices.length}` : undefined} to={devices.length ? "/devices" : undefined}>
      {devices.length === 0 ? (
        <RailEmpty>还没有连接的电脑。</RailEmpty>
      ) : (
        <ul className="-mx-2">
          {devices.slice(0, MAX_ROWS).map((d) => {
            const Icon = OS_ICON[d.os] ?? Monitor;
            return (
              <li key={d.id}>
                <button type="button" onClick={() => navigate("/devices")} className={cn(rowBtn, "gap-2.5", !d.online && "opacity-70")}>
                  <Icon className="size-[18px] shrink-0 text-ink-soft" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                  <Dot tone={d.online ? "mint" : "neutral"} size={8} pulse={d.online} role="img" aria-label={d.online ? "在线" : "离线"} />
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

/** 主线页右栏内容（放进 PageBody 的 rail）：进行中 / 需要你 / 日程 / 团队在线 / 已连接电脑。 */
export function RightRail({ now }: { now: number }) {
  const tasks = useHub((s) => s.model.tasks);
  const triggers = useHub((s) => s.model.triggers);
  const devices = useHub((s) => s.model.devices);
  const bots = useHub((s) => s.model.bots);
  const active = useMemo(
    () => Object.values(tasks).filter((t) => ACTIVE_STATUSES.includes(t.status)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [tasks],
  );
  const cron = useMemo(() => Object.values(triggers).filter((t) => t.source === "cron").sort((a, b) => Number(b.enabled) - Number(a.enabled)), [triggers]);
  const deviceList = useMemo(() => Object.values(devices).sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || Number(b.online) - Number(a.online)), [devices]);
  const members = useMemo(() => Object.values(bots).filter((b) => b.kind !== "main"), [bots]);
  return (
    <>
      <ActiveTasks tasks={active} />
      <NeedsYou />
      <Schedule triggers={cron} now={now} />
      <Team members={members} />
      <Devices devices={deviceList} />
    </>
  );
}
