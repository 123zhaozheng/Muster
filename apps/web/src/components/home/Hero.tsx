import { useMemo } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, ShieldAlert, Wallet, Zap } from "lucide-react";
import type { Bot } from "@muster/protocol";
import { Pebble, StatCard } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { ACTIVE_STATUSES } from "./DispatchCard";
import { greetingFor, isSameLocalDay, summaryLine } from "./time";

type PipLook = Pick<Bot, "name" | "shape" | "color" | "status">;

/** 首页概览数字：进行中 / 待审批 / 今日完成 / 本周花费。 */
export function useHomeStats(now: number) {
  const tasks = useHub((s) => s.model.tasks);
  const approvals = useHub((s) => s.model.approvals);
  const bots = useHub((s) => s.model.bots);
  return useMemo(() => {
    const all = Object.values(tasks);
    const active = all.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
    const waiting = all.filter((t) => t.status === "waiting_approval").length;
    const pending = Object.values(approvals).filter((a) => a.status === "pending").length;
    const doneToday = all.filter((t) => t.status === "done" && isSameLocalDay(t.finishedAt, now)).length;
    const weekCost = Object.values(bots).reduce((sum, b) => sum + (b.costWeekUsd || 0), 0);
    return { active, waiting, pending, doneToday, weekCost };
  }, [tasks, approvals, bots, now]);
}

/** 顶部 Hero：会动的大 Pip + 问候 + 今日概况，右侧 4 张统计卡。 */
export function Hero({ pip, now }: { pip: PipLook; now: number }) {
  const navigate = useNavigate();
  const stats = useHomeStats(now);
  const greeting = greetingFor(new Date().getHours());
  return (
    <section className="muster-page-enter flex flex-wrap items-stretch gap-x-8 gap-y-5" aria-label="今日概况">
      <div className="flex min-w-[300px] flex-1 basis-[340px] items-center gap-5">
        <div className="muster-gradient-brand-soft relative grid size-[104px] shrink-0 place-items-center rounded-[30px] border border-white/70 shadow-soft">
          <Pebble shape={pip.shape} color={pip.color} status={pip.status} size={84} halo title={pip.name} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight text-ink">
            <span className="muster-text-gradient">{greeting}</span>
            <span className="text-ink-faint">，</span>
            {pip.name} 在这儿
          </h1>
          <p className="mt-1.5 text-[15px] leading-[22px] text-ink-soft">{summaryLine(stats.active, stats.pending)}</p>
        </div>
      </div>
      <div className="@container min-w-0 flex-[2.4] basis-[420px]">
        <div className="muster-stagger grid grid-cols-2 gap-4 @xl:grid-cols-4">
          <StatCard label="进行中" value={stats.active} icon={<Zap />} tone="amber" hint={stats.waiting ? `${stats.waiting} 个在等审批` : "全部顺利"} />
          <StatCard label="待审批" value={stats.pending} icon={<ShieldAlert />} tone="coral" hint={stats.pending ? "点击去处理" : "没有积压"} onClick={() => navigate("/inbox")} />
          <StatCard label="今日完成" value={stats.doneToday} icon={<CheckCircle2 />} tone="mint" hint="按本地日期统计" onClick={() => navigate("/events")} />
          <StatCard label="本周花费" value={stats.weekCost} icon={<Wallet />} tone="sky" prefix="$" decimals={2} hint="全部成员合计" onClick={() => navigate("/costs")} />
        </div>
      </div>
    </section>
  );
}
