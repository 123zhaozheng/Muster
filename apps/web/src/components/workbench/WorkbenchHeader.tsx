// 工作台头部：大号会动头像（状态驱动）、名字 + 引擎/模型、状态、分支/目录、用时/Token/花费，以及操作。
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Clock, Coins, Cpu, FolderGit2, GitBranch, MoreHorizontal, Network, Octagon, Pause, Zap } from "lucide-react";
import type { Bot, Task } from "@muster/protocol";
import { AnimatedNumber, Button, Card, Chip, ConfirmDialog, Pebble, ProgressBar, StatusPill, STATUS_COLOR, cn } from "@muster/ui";
import { useNow } from "../../shell/useNow";
import { formatDuration, formatTokens, isBusy, modelLabel, taskAvatarStatus, taskElapsedMs } from "./logic";

export interface WorkbenchHeaderProps {
  task: Task;
  bot: Bot | undefined;
  onInterrupt: () => void;
  /** 二次确认后调用；抛错则确认框保持打开。 */
  onCancel: () => void | Promise<void>;
}

const ACTIVE = new Set(["queued", "running", "waiting_approval"]);

function Metric({ icon, label, children, tone }: { icon: React.ReactNode; label: string; children: React.ReactNode; tone: string }) {
  return (
    <div className="flex min-w-[104px] items-center gap-2.5 rounded-2xl bg-surface/70 px-3 py-2 ring-1 ring-line/70 backdrop-blur">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] leading-4 text-ink-faint">{label}</div>
        <div className="text-sm font-semibold leading-5 tabular-nums">{children}</div>
      </div>
    </div>
  );
}

export function WorkbenchHeader({ task, bot, onInterrupt, onCancel }: WorkbenchHeaderProps) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const busy = isBusy(task);
  const now = useNow(busy ? 1000 : 60_000);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const status = taskAvatarStatus(task, bot?.status);
  const accent = STATUS_COLOR[status];
  const elapsed = taskElapsedMs(task, now);
  const model = modelLabel(bot);

  return (
    <Card frosted className="relative shrink-0 overflow-hidden p-0">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70 transition-[background] duration-500" style={{ background: `radial-gradient(60% 140% at 8% 0%, ${accent}26, transparent 70%), radial-gradient(40% 120% at 100% 0%, rgb(139 124 246 / 0.10), transparent 70%)` }} />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
        <Pebble shape={bot?.shape ?? "round"} color={bot?.color ?? "cream"} status={status} size={92} halo title={bot?.name ?? "Bot"} />
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="truncate text-2xl font-semibold leading-8 tracking-tight">{bot?.name ?? "Bot"}</div>
            <StatusPill status={status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {bot?.engineLabel && <Chip tone="lavender" icon={<Cpu size={13} />}>{bot.engineLabel}</Chip>}
            <Chip tone={model ? "sky" : "neutral"} icon={<Network size={13} />} className="max-w-60 font-mono" title={model ? `模型：${model}` : "未单独指定模型，使用设置里的默认模型"}>
              <span className="truncate">{model ?? "默认模型"}</span>
            </Chip>
            {task.branch && (
              <Chip tone="neutral" icon={<GitBranch size={13} />} className="max-w-56 font-mono" title={`Git 分支：${task.branch}`}>
                <span className="truncate">{task.branch}</span>
              </Chip>
            )}
            {task.cwd && (
              <Chip tone="neutral" icon={<FolderGit2 size={13} />} className="max-w-60 font-mono" title={`工作目录：${task.cwd}`}>
                <span className="truncate">{task.cwd}</span>
              </Chip>
            )}
          </div>
          <div className="mt-1.5 truncate text-sm text-ink-soft">任务：{task.title}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Metric icon={<Clock size={16} />} label="已用时间" tone="bg-mint-soft text-mint-deep">{elapsed === undefined ? "—" : formatDuration(elapsed)}</Metric>
          <Metric icon={<Zap size={16} />} label="Token" tone="bg-lavender-soft text-lavender-deep">{task.tokens === undefined ? "—" : <AnimatedNumber value={task.tokens} format={formatTokens} />}</Metric>
          <Metric icon={<Coins size={16} />} label="花费" tone="bg-coral-soft text-coral-deep">{task.costUsd === undefined ? "—" : <AnimatedNumber value={task.costUsd} decimals={2} prefix="$" />}</Metric>
        </div>
        <div className="flex items-center gap-2">
          {busy && (
            <Button variant="outline" aria-label="打断任务" icon={<Pause size={16} />} onClick={onInterrupt}>打断</Button>
          )}
          <Link to={`/task/${task.id}/branches`} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink shadow-soft transition-[transform,background-color] duration-200 ease-muster hover:-translate-y-px hover:bg-canvas-deep active:scale-[0.97]">
            <GitBranch size={16} />
            查看分支
          </Link>
          <div className="relative" ref={menuRef}>
            <Button variant="outline" aria-label="更多" aria-haspopup="menu" aria-expanded={menu} className="size-10 !px-0" onClick={() => setMenu((v) => !v)}>
              <MoreHorizontal size={18} />
            </Button>
            {menu && (
              <div role="menu" className="muster-glass-3 muster-pop absolute right-0 top-12 z-30 w-44 overflow-hidden rounded-2xl p-1.5" data-state="open">
                <Link role="menuitem" to={`/task/${task.id}/branches`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-canvas-deep" onClick={() => setMenu(false)}>
                  <GitBranch size={15} className="text-lavender-deep" />
                  查看分支
                </Link>
                {ACTIVE.has(task.status) && (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
                    onClick={() => {
                      setMenu(false);
                      setConfirm(true);
                    }}
                  >
                    <Octagon size={15} />
                    取消任务
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {busy && task.progress !== undefined && (
        <div className="relative px-5 pb-3.5">
          <ProgressBar value={task.progress} tone={status === "waiting_approval" ? "amber" : "mint"} size="sm" label="任务进度" />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title="取消这个任务？"
        description={`${bot?.name ?? "Bot"} 会立即停止「${task.title}」，已产生的改动会保留在工作目录里。`}
        confirmText="确认取消"
        cancelText="再想想"
        onConfirm={onCancel}
      />
    </Card>
  );
}
