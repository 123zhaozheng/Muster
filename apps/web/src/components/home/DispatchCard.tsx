import { useNavigate } from "react-router";
import { Clock } from "lucide-react";
import type { Task, TaskId, TaskStatus } from "@muster/protocol";
import { AnimatedNumber, Badge, Chip, Pebble, ProgressBar as UiProgressBar, cn, type ChipTone } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { useServerNow } from "./serverClock";
import { taskTimeText } from "./time";

type BarTone = "coral" | "mint" | "lavender" | "amber" | "sky" | "danger";

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: ChipTone; bar: BarTone }> = {
  queued: { label: "排队中", tone: "neutral", bar: "sky" },
  running: { label: "工作中", tone: "mint", bar: "mint" },
  waiting_approval: { label: "等你审批", tone: "amber", bar: "amber" },
  done: { label: "已完成", tone: "mint", bar: "mint" },
  failed: { label: "失败", tone: "danger", bar: "danger" },
  cancelled: { label: "已取消", tone: "neutral", bar: "sky" },
};

/** 进行中的状态：计入统计、右栏与每秒计时。 */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ["queued", "running", "waiting_approval"];

/** 任务进度 0..100；已完成视为 100，未知返回 undefined。 */
export function taskPercent(task: Pick<Task, "status" | "progress">): number | undefined {
  if (task.progress !== undefined) return Math.min(100, Math.max(0, task.progress));
  return task.status === "done" ? 100 : undefined;
}

const KIND_LABEL: Record<string, string> = { main: "主 Bot", codex: "Codex", claude: "Claude", acp: "ACP", native: "内置" };

/** 主线里的派发卡：Pip 把任务交给某个子 Bot 后出现，点击进入该任务的工作台。 */
export function DispatchCard({ botId, taskId, title }: { botId: string; taskId: TaskId; title: string }) {
  const navigate = useNavigate();
  const bot = useHub((s) => s.model.bots[botId]);
  const task: Task | undefined = useHub((s) => s.model.tasks[taskId]);
  const live = !!task && ACTIVE_STATUSES.includes(task.status) && task.status !== "queued";
  // 只有进行中的卡片才每秒刷新“已用时间”
  const now = useServerNow(live ? 1000 : 0);
  const st = task ? TASK_STATUS[task.status] : undefined;
  const pct = task ? taskPercent(task) : undefined;
  const open = () => navigate(`/task/${taskId}`);
  const tint = bot ? `var(--color-pebble-${bot.color})` : "transparent";
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`打开任务：${title}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="muster-frost hover-lift group relative w-[300px] min-w-[260px] max-w-[380px] flex-1 shrink-0 cursor-pointer snap-start overflow-hidden rounded-card p-4 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-coral/50"
      style={{ backgroundImage: `linear-gradient(140deg, color-mix(in srgb, ${tint} 42%, transparent), transparent 72%)` }}
    >
      <div className="flex items-start gap-3">
        {bot && (
          <div className="relative -ml-1 grid size-[56px] shrink-0 place-items-center">
            <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={52} title={bot.name} halo={task?.status === "running"} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{bot?.name ?? "子 Bot"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge size="sm" tone="neutral" variant="outline">{bot?.engineLabel ?? KIND_LABEL[bot?.kind ?? ""] ?? "成员"}</Badge>
            {bot?.model && <Badge size="sm" tone="sky" title={`${bot.model.provider} / ${bot.model.modelId}`}>{bot.model.modelId}</Badge>}
          </div>
        </div>
        {st && <Chip tone={st.tone} className="shrink-0" icon={<span className={cn("size-1.5 rounded-full bg-current", task?.status === "running" && "animate-pulse")} />}>{st.label}</Chip>}
      </div>
      <div className="mt-3 line-clamp-2 min-h-[44px] text-[15px] font-semibold leading-snug">{task?.title ?? title}</div>
      {st && task && (
        <>
          <div className="mt-3 flex items-center gap-3">
            {pct !== undefined ? (
              <UiProgressBar className="flex-1" value={pct} tone={st.bar} label={`${title} 进度`} />
            ) : (
              <UiProgressBar className="flex-1" value={0} tone={st.bar} label={`${title} 进度`} indeterminate={task.status === "running"} />
            )}
            <span className="w-11 text-right text-sm font-medium">
              {pct !== undefined ? <AnimatedNumber value={Math.round(pct)} suffix="%" /> : "--"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-ink-soft">
            <Clock className="size-3.5 text-ink-faint" aria-hidden />
            {taskTimeText(task, now)}
          </div>
        </>
      )}
    </div>
  );
}

/** 连续派发的卡片排成横向卡组（窄屏可横向滑动）。 */
export function DispatchDeck({ items }: { items: { id: string; botId: string; taskId: TaskId; title: string }[] }) {
  return (
    <div className="muster-stagger -mx-1 flex snap-x gap-4 overflow-x-auto overflow-y-hidden px-1 pb-3 pt-1" role="group" aria-label="任务派发">
      {items.map((d) => <DispatchCard key={d.id} botId={d.botId} taskId={d.taskId} title={d.title} />)}
    </div>
  );
}
