import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import type { Bot, Task } from "@muster/protocol";
import { cn, type Tone } from "@muster/ui";
import { taskStatusMeta } from "../../lib/status";
import { MemberAvatar } from "./MemberAvatar";
import { formatSpan } from "./stream";

/** One honest line derived from the status alone, used when the caller has no real result/stage text. */
const STAGE_TEXT: Record<Task["status"], string> = {
  queued: "等待开始",
  running: "正在执行",
  waiting_approval: "需要你确认后继续",
  done: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-fg-3",
};

interface TaskRowProps {
  task: Pick<Task, "id" | "title" | "status">;
  bot?: Pick<Bot, "name" | "shape" | "color" | "status">;
  /** 真实结果或当前阶段（如成员最后一句话），展开后显示；没有时用状态推出的一句话。 */
  summary?: ReactNode;
  /** 用时（毫秒），由调用方按 startedAt / finishedAt 算好。 */
  elapsedMs?: number;
  /** 详情入口。默认 /task/:id。 */
  to?: string;
  className?: string;
}

/**
 * 任务组里的一行，默认收起：状态图标、成员头像、“成员 · 标题”、用时、展开箭头。
 * 点开才显示 2–3 行摘要和“查看详情”。不画进度条：task.progress 不可靠。
 */
export function TaskRow({ task, bot, summary, elapsedMs, to, className }: TaskRowProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const meta = taskStatusMeta(task.status);
  const Icon = meta.icon;
  const title = bot ? `${bot.name} · ${task.title}` : task.title;
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <Icon role="img" aria-label={meta.label} className={cn("size-4 shrink-0", TONE_TEXT[meta.tone], task.status === "running" && "animate-spin [animation-duration:2s] motion-reduce:animate-none")} />
        {bot && <MemberAvatar bot={bot} size={20} />}
        <span className="min-w-0 flex-1 truncate text-fg">{title}</span>
        {elapsedMs !== undefined && <span className="shrink-0 text-xs tabular-nums text-fg-3">{formatSpan(elapsedMs)}</span>}
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div id={bodyId} className="px-3 pb-3 pl-[34px] text-caption text-fg-2">
          <div className="line-clamp-3 whitespace-pre-wrap break-words">{summary ?? STAGE_TEXT[task.status]}</div>
          <Link
            to={to ?? `/task/${task.id}`}
            aria-label={`查看详情：${task.title}`}
            className="mt-1.5 inline-flex items-center gap-0.5 rounded-control font-medium text-accent hover:text-accent-hover"
          >
            查看详情
            <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
