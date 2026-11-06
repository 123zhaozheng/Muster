// 分支对比卡片：头像、标签、推荐、摘要、变更文件数、测试结果、Token、采用 / 继续；并排对比时高亮最优项。
import { Crown, Sparkles } from "lucide-react";
import type { Bot, Branch } from "@muster/protocol";
import { Button, Card, Chip, Pebble, cn } from "@muster/ui";
import { IconAlert, IconCheck, IconCoin, IconFile } from "../workbench/icons";
import { formatTokens } from "../workbench/logic";
import type { BranchVerdict } from "./compare";

/** 测试全部通过（至少跑过 1 个）才推荐。 */
export function isRecommended(b: Branch): boolean {
  return !!b.tests && b.tests.failed === 0 && b.tests.passed > 0;
}

export interface BranchCardProps {
  branch: Branch;
  bot: Pick<Bot, "shape" | "color" | "status" | "name"> | undefined;
  tone: { stroke: string; soft: string };
  adopting?: boolean;
  /** 来自 compareBranches；不传则不做差异高亮。 */
  verdict?: BranchVerdict;
  /** 用户当前所在的就是这个分支。 */
  current?: boolean;
  onAdopt: () => void;
  onContinue: () => void;
}

const GOLD = "#e9a82b";

function Best({ children }: { children: string }) {
  return <span className="rounded-pill bg-mint-soft px-1.5 py-0.5 text-[10px] font-semibold text-mint-deep">{children}</span>;
}

export function BranchCard({ branch, bot, tone, adopting, verdict, current, onAdopt, onContinue }: BranchCardProps) {
  const t = branch.tests;
  const allPass = isRecommended(branch);
  const failing = !!t && t.failed > 0;
  const total = t ? t.passed + t.failed : 0;
  const adopted = !!branch.adopted;
  return (
    <Card
      hoverable
      className={cn("relative flex flex-col overflow-hidden p-5", adopted && "ring-2")}
      style={{ background: `linear-gradient(160deg, ${adopted ? "#fff3d1" : tone.soft}, var(--color-surface) 58%)`, ...(adopted ? ({ "--tw-ring-color": GOLD } as React.CSSProperties) : null) }}
      data-testid="branch-card"
      data-branch-id={branch.id}
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-40 blur-2xl" style={{ background: adopted ? GOLD : tone.stroke }} />
      <div className="relative flex items-center gap-4">
        {bot && <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={64} halo title={bot.name} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{branch.label}</h3>
            {allPass && <Chip tone="mint" icon={<Sparkles size={12} />}>推荐</Chip>}
            {adopted && <Chip tone="amber" icon={<Crown size={12} />}>已采用</Chip>}
            {current && <Chip tone="coral">当前</Chip>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{branch.summary}</p>
        </div>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-white shadow-soft", allPass ? "bg-mint" : failing ? "bg-amber" : "bg-ink-faint")}>
          {allPass ? <IconCheck size={17} /> : <IconAlert size={17} />}
        </span>
      </div>
      <dl className="relative mt-5 grid grid-cols-3 gap-3 border-y border-line/80 py-4 text-sm">
        <div className={cn("rounded-xl p-2 transition-colors", verdict?.fewestFiles && "bg-mint-soft/60")}>
          <dt className="flex flex-wrap items-center gap-1.5 text-ink-soft"><IconFile size={15} />变更文件{verdict?.fewestFiles && <Best>最少</Best>}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{branch.filesChanged} 个</dd>
          {!!verdict && verdict.filesOver > 0 && <div className="text-[11px] text-ink-faint">比最少多 {verdict.filesOver} 个</div>}
        </div>
        <div className={cn("rounded-xl p-2 transition-colors", verdict?.bestTests && "bg-mint-soft/60")}>
          <dt className="flex flex-wrap items-center gap-1.5 text-ink-soft">{allPass ? <span className="text-mint"><IconCheck size={15} /></span> : <span className="text-amber"><IconAlert size={15} /></span>}测试结果{verdict?.bestTests && <Best>最优</Best>}</dt>
          <dd className={cn("mt-1 text-xl font-semibold", allPass ? "text-mint-deep" : failing ? "text-danger-deep" : "text-ink-faint")}>
            {!t ? "未运行" : failing ? `${t.failed} 个失败` : allPass ? "全部通过" : "无测试"}
          </dd>
          {total > 0 && (
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="bg-mint" style={{ width: `${(t!.passed / total) * 100}%` }} />
              <span className="bg-danger" style={{ width: `${(t!.failed / total) * 100}%` }} />
            </div>
          )}
        </div>
        <div className={cn("rounded-xl p-2 transition-colors", verdict?.cheapest && "bg-mint-soft/60")}>
          <dt className="flex flex-wrap items-center gap-1.5 text-ink-soft"><IconCoin size={15} />Token 消耗{verdict?.cheapest && <Best>最省</Best>}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{formatTokens(branch.tokens)}</dd>
          {!!verdict && !!verdict.tokensOver && <div className="text-[11px] text-ink-faint">比最省多 {formatTokens(verdict.tokensOver)}</div>}
        </div>
      </dl>
      <div className="relative mt-5 flex gap-3">
        <Button variant="primary" size="lg" className="flex-1" loading={adopting} disabled={adopted} onClick={onAdopt}>
          {adopted ? "已采用" : "采用此分支"}
        </Button>
        <Button variant="outline" size="lg" className="flex-1" onClick={onContinue}>继续这个分支</Button>
      </div>
    </Card>
  );
}
