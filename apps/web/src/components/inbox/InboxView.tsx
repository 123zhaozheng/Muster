import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CheckCircle2, Filter, Inbox as InboxIcon, ShieldAlert, XCircle } from "lucide-react";
import { MAIN_BOT_ID, type Approval, type BotId, type Risk } from "@muster/protocol";
import { Badge, Card, CountBadge, Empty, Section, StatCard, cn } from "@muster/ui";
import { PageBody } from "../layout";
import { useHub } from "../../lib/hub";
import { relativeTime } from "../../lib/format";
import { useNow } from "../../shell/useNow";
import { BotAvatar } from "../BotAvatar";
import { InboxApprovalCard, RISK_ICON, RISK_META } from "./InboxApprovalCard";

type RiskFilter = Risk | "all";
const RISKS: Risk[] = ["high", "medium", "low"];

const STATUS_TEXT = { allowed: "已允许", denied: "已拒绝", expired: "已过期" } as const;

/** 收件箱主体：概览统计 → 待处理大卡（可按 Bot / 风险筛选）→ 折叠的已处理；右栏放审批规则说明。 */
export function InboxView() {
  const approvals = useHub((s) => s.model.approvals);
  const bots = useHub((s) => s.model.bots);
  const pipName = bots[MAIN_BOT_ID]?.name ?? "Pip";
  const now = useNow();
  const [botFilter, setBotFilter] = useState<BotId | "all">("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [showResolved, setShowResolved] = useState(false);

  const { pending, resolved, pendingAll, pendingByBot, highPending, doneToday } = useMemo(() => {
    const all = Object.values(approvals);
    const pendingAllList = all.filter((a) => a.status === "pending");
    const counts: Record<string, number> = {};
    for (const a of pendingAllList) counts[a.botId] = (counts[a.botId] ?? 0) + 1;
    const match = (a: Approval) => (botFilter === "all" || a.botId === botFilter) && (riskFilter === "all" || a.risk === riskFilter);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const resolvedAll = all.filter((a) => a.status !== "pending");
    return {
      pendingAll: pendingAllList,
      pending: pendingAllList.filter(match).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      resolved: resolvedAll.filter(match).sort((a, b) => ((a.resolvedAt ?? a.createdAt) < (b.resolvedAt ?? b.createdAt) ? 1 : -1)),
      pendingByBot: counts,
      highPending: pendingAllList.filter((a) => a.risk === "high").length,
      doneToday: resolvedAll.filter((a) => Date.parse(a.resolvedAt ?? a.createdAt) >= startOfDay.getTime()).length,
    };
  }, [approvals, botFilter, riskFilter]);

  const botList = Object.values(bots);
  const filtering = botFilter !== "all" || riskFilter !== "all";
  const clearFilters = () => {
    setBotFilter("all");
    setRiskFilter("all");
  };

  return (
    <>
      <div className="muster-stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard label="待处理" value={pendingAll.length} icon={<InboxIcon />} tone="amber" hint={pendingAll.length > 0 ? "需要你点头" : "全部清空"} />
        <StatCard label="今天已处理" value={doneToday} icon={<CheckCircle2 />} tone="mint" hint="允许或拒绝都算" />
        <StatCard label="高风险待处理" value={highPending} icon={<ShieldAlert />} tone={highPending > 0 ? "danger" : "neutral"} hint={highPending > 0 ? "建议先看这些" : "没有高风险项"} />
      </div>

      <PageBody
        main={
          <>
            <Section
              title={<>待处理<CountBadge count={pending.length} tone="amber" className="ml-1" /></>}
              description="Bot 要做的敏感操作会先停在这里，等你决定。"
              actions={
                filtering ? (
                  <button type="button" onClick={clearFilters} className="cursor-pointer rounded-pill px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-canvas-deep hover:text-ink">
                    清除筛选
                  </button>
                ) : undefined
              }
            >
              <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="按 Bot 筛选">
                <Filter className="size-4 text-ink-faint" aria-hidden />
                <FilterChip active={botFilter === "all"} onClick={() => setBotFilter("all")}>全部</FilterChip>
                {botList.map((b) => (
                  <FilterChip key={b.id} active={botFilter === b.id} onClick={() => setBotFilter(b.id)}>
                    <BotAvatar bot={b} size={18} className="-ml-1" />
                    {b.name}
                    {(pendingByBot[b.id] ?? 0) > 0 && <span className="ml-0.5 font-semibold text-coral-deep tabular-nums">{pendingByBot[b.id]}</span>}
                  </FilterChip>
                ))}
              </div>
              <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="按风险筛选">
                <span className="mr-1 text-xs text-ink-faint">风险</span>
                <FilterChip active={riskFilter === "all"} onClick={() => setRiskFilter("all")}>不限</FilterChip>
                {RISKS.map((r) => (
                  <FilterChip key={r} active={riskFilter === r} onClick={() => setRiskFilter(r)}>
                    {RISK_META[r].label}
                  </FilterChip>
                ))}
              </div>

              {pending.length === 0 ? (
                pendingAll.length === 0 ? (
                  <Card className="muster-glass-1">
                    <Empty
                      pebble={{ status: "done", color: bots[MAIN_BOT_ID]?.color ?? "cream", shape: bots[MAIN_BOT_ID]?.shape ?? "round" }}
                      title={`都处理完了，${pipName} 很满意`}
                      description="Bot 需要你确认的操作会第一时间出现在这里。去喝杯水吧。"
                    />
                  </Card>
                ) : (
                  <Card className="muster-glass-1">
                    <Empty
                      compact
                      pebble={{ status: "sleeping", color: "lilac" }}
                      title="没有待处理的审批"
                      description={`当前筛选条件下没有审批，全部共有 ${pendingAll.length} 项待处理。`}
                      action={<button type="button" onClick={clearFilters} className="cursor-pointer rounded-pill bg-coral-soft px-4 py-1.5 text-sm font-medium text-coral-deep hover:bg-coral-soft/70">清除筛选</button>}
                    />
                  </Card>
                )
              ) : (
                <div className="muster-stagger grid gap-4">
                  {pending.map((a) => (
                    <InboxApprovalCard key={a.id} approval={a} now={now} />
                  ))}
                </div>
              )}
            </Section>

            <section aria-label="已处理">
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                aria-expanded={showResolved}
                className="flex cursor-pointer items-center gap-1.5 rounded-pill py-1 pr-3 text-[17px] font-semibold text-ink transition-colors hover:text-coral-deep"
              >
                <ChevronRight className={cn("size-5 transition-transform duration-200 ease-muster", showResolved && "rotate-90")} />
                已处理 · {resolved.length}
              </button>
              {showResolved && (
                <div className="muster-rise mt-3.5">
                  {resolved.length === 0 ? (
                    <Card className="px-5 py-6 text-center text-sm text-ink-faint">还没有已处理的审批。</Card>
                  ) : (
                    <Card className="divide-y divide-line/70 overflow-hidden">
                      {resolved.map((a) => (
                        <ResolvedRow key={a.id} approval={a} now={now} />
                      ))}
                    </Card>
                  )}
                </div>
              )}
            </section>
          </>
        }
        rail={
          <>
            <Card className="muster-glass-2 p-5">
              <h3 className="text-[15px] font-semibold text-ink">风险分级</h3>
              <ul className="mt-3 grid gap-3">
                {RISKS.slice().reverse().map((r) => {
                  const Icon = RISK_ICON[r];
                  return (
                    <li key={r} className="flex items-start gap-3">
                      <Badge tone={RISK_META[r].tone} className="mt-0.5 shrink-0" icon={<Icon className="size-3.5" />}>{RISK_META[r].label}</Badge>
                      <span className="text-sm leading-6 text-ink-soft">{RISK_META[r].hint}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card className="muster-gradient-brand-soft p-5">
              <h3 className="text-[15px] font-semibold text-ink">小提示</h3>
              <ul className="mt-2.5 grid gap-2 text-sm leading-6 text-ink-soft">
                <li>「总是允许」只对同类的中低风险操作生效。</li>
                <li>高风险操作每次都会二次确认，不能被记住。</li>
                <li>无人值守触发的审批，超时会按触发器规则自动拒绝。</li>
              </ul>
            </Card>
          </>
        }
      />
    </>
  );
}

function ResolvedRow({ approval, now }: { approval: Approval; now: number }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const ok = approval.status === "allowed";
  return (
    <div className="flex items-center gap-3.5 px-5 py-3.5">
      {bot && <BotAvatar bot={{ ...bot, status: "idle" }} size={32} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{approval.title}</div>
        {approval.detail && <div className="truncate font-mono text-xs text-ink-faint">{approval.detail}</div>}
      </div>
      <Badge tone={RISK_META[approval.risk].tone} variant="outline" size="sm">{RISK_META[approval.risk].label}</Badge>
      <Badge tone={ok ? "mint" : approval.status === "denied" ? "danger" : "neutral"} icon={ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}>
        {STATUS_TEXT[approval.status as keyof typeof STATUS_TEXT] ?? "已处理"}
      </Badge>
      <time className="w-20 shrink-0 text-right text-xs text-ink-faint" dateTime={approval.resolvedAt ?? approval.createdAt}>
        {relativeTime(approval.resolvedAt ?? approval.createdAt, now)}
      </time>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-3 py-1 text-sm transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-muster active:scale-[0.97]",
        active ? "border-coral/40 bg-coral-soft font-medium text-coral-deep shadow-soft" : "border-line bg-surface text-ink-soft hover:border-ink-faint/40 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
