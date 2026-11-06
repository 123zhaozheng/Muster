import { useMemo } from "react";
import { Link } from "react-router";
import { Card, EmptyState } from "@muster/ui";
import { MemberAvatar, TaskStatusBadge } from "../common";
import { useHub } from "../../lib/hub";
import { relativeTime, usd } from "../../lib/format";
import { formatTokens } from "../workbench/logic";

const TH = "px-4 py-2.5 text-left text-xs font-medium text-fg-3";
const TD = "px-4 py-3";

/** Total across all members, from each bot's accumulated cost. null when nothing has been reported anywhere. */
export function useCostTotal(): number | null {
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  return useMemo(() => {
    const total = Object.values(bots).reduce((n, b) => n + b.costWeekUsd, 0);
    const anyTaskCost = Object.values(tasks).some((t) => t.costUsd !== undefined);
    return total > 0 || anyTaskCost ? total : null;
  }, [bots, tasks]);
}

export function CostTotal({ total }: { total: number }) {
  return (
    <Card className="p-6">
      <div className="text-caption text-fg-2">全部成员累计花费</div>
      <div className="mt-1 text-[40px] font-semibold leading-tight tabular-nums text-fg">{usd(total)}</div>
      <p className="mt-1 text-caption text-fg-3">自守护进程首次启动起累计 · 估算 · USD</p>
    </Card>
  );
}

export function MemberCostTable({ total }: { total: number }) {
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  const rows = useMemo(() => {
    const count: Record<string, number> = {};
    for (const t of Object.values(tasks)) count[t.botId] = (count[t.botId] ?? 0) + 1;
    return Object.values(bots)
      .map((bot) => ({ bot, tasks: count[bot.id] ?? 0 }))
      .sort((a, b) => b.bot.costWeekUsd - a.bot.costWeekUsd);
  }, [bots, tasks]);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={TH}>成员</th>
            <th scope="col" className={`${TH} text-right`}>任务数</th>
            <th scope="col" className={`${TH} text-right`}>占比</th>
            <th scope="col" className={`${TH} text-right`}>花费</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ bot, tasks: n }) => (
            <tr key={bot.id}>
              <td className={TD}>
                <span className="flex items-center gap-3">
                  <MemberAvatar bot={bot} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{bot.name}</span>
                    <span className="block truncate text-xs text-fg-3">{bot.engineLabel}</span>
                  </span>
                </span>
              </td>
              <td className={`${TD} text-right tabular-nums text-fg-2`}>{n}</td>
              <td className={`${TD} text-right tabular-nums text-fg-2`}>{total > 0 ? `${Math.round((bot.costWeekUsd / total) * 100)}%` : "—"}</td>
              <td className={`${TD} text-right font-medium tabular-nums text-fg`}>{usd(bot.costWeekUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function TaskCostTable() {
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  const rows = useMemo(
    () =>
      Object.values(tasks).sort((a, b) => {
        if (a.costUsd === undefined && b.costUsd !== undefined) return 1;
        if (b.costUsd === undefined && a.costUsd !== undefined) return -1;
        const d = (b.costUsd ?? 0) - (a.costUsd ?? 0);
        return d !== 0 ? d : a.startedAt < b.startedAt ? 1 : -1;
      }),
    [tasks],
  );
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState compact title="还没有任务" description="派发任务后，这里会显示每个任务的 tokens 与花费。" />
      </Card>
    );
  }
  return (
    <>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={TH}>任务</th>
              <th scope="col" className={TH}>成员</th>
              <th scope="col" className={TH}>状态</th>
              <th scope="col" className={TH}>开始</th>
              <th scope="col" className={`${TH} text-right`}>tokens</th>
              <th scope="col" className={`${TH} text-right`}>花费</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => (
              <tr key={t.id}>
                <td className={`${TD} max-w-72 truncate font-medium`}>
                  <Link to={`/task/${t.id}`} className="text-fg hover:text-accent hover:underline">{t.title}</Link>
                </td>
                <td className={`${TD} text-fg-2`}>{bots[t.botId]?.name ?? t.botId}</td>
                <td className={TD}><TaskStatusBadge status={t.status} /></td>
                <td className={`${TD} whitespace-nowrap text-fg-3`}>{relativeTime(t.startedAt)}</td>
                <td className={`${TD} text-right tabular-nums text-fg-2`}>{formatTokens(t.tokens)}</td>
                <td className={`${TD} text-right font-medium tabular-nums text-fg`}>{usd(t.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-caption text-fg-3">tokens 与花费由各驱动上报，没有上报的显示 —。</p>
    </>
  );
}
