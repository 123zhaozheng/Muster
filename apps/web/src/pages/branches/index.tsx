// 分支页 /task/:taskId/branches（对照 design/mockups/03-branches.png）
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Crown, GitBranch, ListChecks, Sparkles } from "lucide-react";
import type { Bot, Branch, Task, TaskId } from "@muster/protocol";
import { Empty, Pebble, StatCard, toast } from "@muster/ui";
import { hubRequest, useEntries, useHub } from "../../lib/hub";
import { Page, PageGrid, PageHeader } from "../../components/layout";
import { BranchCard, isRecommended } from "../../components/branches/BranchCard";
import { BranchTree } from "../../components/branches/BranchTree";
import { compareBranches } from "../../components/branches/compare";
import { toneOf } from "../../components/branches/timeline";
import { formatTokens, taskAvatarStatus } from "../../components/workbench/logic";

type AvatarBot = Pick<Bot, "shape" | "color" | "status" | "name">;

/** 沿 forkedFrom 回到最初的任务：分支树以它的对话为主路线。 */
function rootTaskOf(tasks: Record<TaskId, Task>, id: TaskId): Task | undefined {
  let cur = tasks[id];
  for (let guard = 0; cur?.forkedFrom && guard < 32; guard++) {
    const parent = tasks[cur.forkedFrom.taskId];
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

const HOW_TO = ["回到工作台，找到想换个思路的那一步", "把鼠标悬停在那一步上，点右侧的“从这里分支”", "回到这里并排对比结果，采用最好的一条"];

export default function Branches() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const tasks = useHub((s) => s.model.tasks);
  const bots = useHub((s) => s.model.bots);
  const pushed = useHub((s) => s.model.branches);
  const root = rootTaskOf(tasks, taskId);
  const entries = useEntries(root?.threadId);

  const [fetched, setFetched] = useState<Branch[]>([]);
  const [adoptedIds, setAdoptedIds] = useState<ReadonlySet<string>>(new Set());
  const [adopting, setAdopting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rootId = root?.id;

  useEffect(() => {
    if (!rootId) return;
    let live = true;
    hubRequest("task.branches", { taskId: rootId })
      .then((r) => live && setFetched(r.branches))
      .catch(() => {}); // 取不到时退回已推送到 model 的分支
    return () => {
      live = false;
    };
  }, [rootId]);

  // 请求结果 + 实时推送（branch.updated）合并，推送更新优先。
  const branches = useMemo(() => {
    const family = new Set(Object.values(tasks).filter((t) => rootTaskOf(tasks, t.id)?.id === rootId).map((t) => t.id));
    const map = new Map<string, Branch>(fetched.map((b) => [b.id, b]));
    for (const b of Object.values(pushed)) if (family.has(b.taskId)) map.set(b.id, b);
    return [...map.values()].map((b) => (adoptedIds.has(b.id) ? { ...b, adopted: true } : b));
  }, [fetched, pushed, tasks, rootId, adoptedIds]);

  const botOf = useCallback(
    (b: Branch): AvatarBot | undefined => {
      const bot = bots[b.botId];
      return bot && { ...bot, status: taskAvatarStatus(tasks[b.taskId], bot.status) };
    },
    [bots, tasks],
  );
  const rootBotRaw = root ? bots[root.botId] : undefined;
  const rootBot = useMemo<AvatarBot | undefined>(() => rootBotRaw && { ...rootBotRaw, status: taskAvatarStatus(root, rootBotRaw.status) }, [rootBotRaw, root]);
  const liveTaskIds = useMemo(() => new Set(Object.values(tasks).filter((t) => t.status === "running").map((t) => t.id)), [tasks]);
  const verdicts = useMemo(() => compareBranches(branches), [branches]);

  const adopt = (branch: Branch) => {
    setAdopting(branch.id);
    setNotice(null);
    hubRequest("branch.adopt", { branchId: branch.id })
      .then(() => {
        setAdoptedIds((s) => new Set(s).add(branch.id));
        toast.success(`已采用「${branch.label}」`);
      })
      .catch((e: unknown) => {
        const msg = `采用失败：${e instanceof Error ? e.message : String(e)}`;
        setNotice(msg);
        toast.error(msg);
      })
      .finally(() => setAdopting(null));
  };

  if (!root) {
    return (
      <Page>
        <Empty
          pebble={{ shape: "round", color: "cream", status: "sleeping" }}
          title="未找到这个任务"
          description="它可能已被清理，或链接有误。"
          action={<Link to="/" className="inline-flex h-10 items-center rounded-pill bg-coral-soft px-5 text-sm font-medium text-coral-deep transition-colors hover:bg-coral-soft/70">回到主线</Link>}
        />
      </Page>
    );
  }

  const recommended = branches.filter(isRecommended).length;
  const adoptedCount = branches.filter((b) => b.adopted).length;
  const tokenTotal = branches.reduce((a, b) => a + (b.tokens ?? 0), 0);

  return (
    <Page>
      <PageHeader
        leading={<Pebble shape="egg" color="lilac" status={branches.length ? "thinking" : "idle"} size={56} halo />}
        title="分支"
        subtitle={`探索不同的解决方案，选择最优路径 · ${root.title}`}
        actions={
          <Link to={`/task/${taskId}`} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink shadow-soft transition-[transform,background-color] duration-200 ease-muster hover:-translate-y-px hover:bg-canvas-deep active:scale-[0.97]">
            <ArrowLeft size={16} />
            返回工作台
          </Link>
        }
      />
      {notice && <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{notice}</div>}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="分支数" value={branches.length} icon={<GitBranch size={18} />} tone="lavender" hint="从同一个任务分出的思路" />
        <StatCard label="推荐分支" value={recommended} icon={<Sparkles size={18} />} tone="mint" hint="测试全部通过" />
        <StatCard label="已采用" value={adoptedCount} icon={<Crown size={18} />} tone="amber" hint={adoptedCount ? "已合入主线" : "还没选定"} />
        <StatCard label="分支总 Token" value={tokenTotal} format={formatTokens} icon={<ListChecks size={18} />} tone="sky" hint="所有分支合计" />
      </div>
      <BranchTree entries={entries} branches={branches} rootBot={rootBot} botOf={botOf} currentTaskId={taskId} liveTaskIds={liveTaskIds} />
      {branches.length === 0 ? (
        <div className="rounded-card-lg border border-dashed border-line bg-surface-warm/70 px-6 py-10">
          <Empty
            pebble={{ shape: "egg", color: "lilac", status: "thinking" }}
            title="还没有分支"
            description="分支让你在任意一步“换个思路再试一次”，原来的进度不会丢。"
            action={<Link to={`/task/${taskId}`} className="muster-gradient-brand inline-flex h-11 items-center rounded-pill px-6 text-sm font-medium text-white shadow-glow-coral transition-transform hover:-translate-y-px active:scale-[0.97]">去工作台创建分支</Link>}
          />
          <ol className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
            {HOW_TO.map((t, i) => (
              <li key={t} className="flex items-start gap-3 rounded-2xl bg-surface p-4 text-sm shadow-soft">
                <span className="muster-gradient-brand grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white">{i + 1}</span>
                <span className="leading-relaxed text-ink-soft">{t}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <PageGrid min={440}>
          {branches.map((b, i) => (
            <BranchCard
              key={b.id}
              branch={b}
              bot={botOf(b)}
              tone={toneOf(i)}
              verdict={verdicts[b.id]}
              current={b.taskId === taskId}
              adopting={adopting === b.id}
              onAdopt={() => adopt(b)}
              onContinue={() => navigate(`/task/${b.taskId}`)}
            />
          ))}
        </PageGrid>
      )}
      {branches.length === 1 && (
        <p className="text-center text-xs text-ink-faint">只有一个分支时没法对比，再从工作台分出一条试试。</p>
      )}
    </Page>
  );
}
