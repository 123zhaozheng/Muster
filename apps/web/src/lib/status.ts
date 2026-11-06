// The single mapping from protocol status -> label / tone / icon / sort weight (docs/12 §3).
// Pages must not define their own status labels or colours: import from here.
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, Moon, Sparkles, XCircle, type LucideIcon } from "lucide-react";
import type { Approval, BotStatus, Task, TaskStatus } from "@muster/protocol";
import type { Tone } from "@muster/ui";

interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** Lower sorts first. */
  order: number;
}

/** Task status. "Paused" does not exist in the protocol and is never shown. */
export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  waiting_approval: { label: "等你确认", tone: "warning", icon: AlertTriangle, order: 0 },
  running: { label: "执行中", tone: "accent", icon: Loader2, order: 1 },
  queued: { label: "排队中", tone: "neutral", icon: Clock, order: 2 },
  failed: { label: "失败", tone: "danger", icon: XCircle, order: 3 },
  done: { label: "已完成", tone: "success", icon: CheckCircle2, order: 4 },
  cancelled: { label: "已取消", tone: "neutral", icon: Ban, order: 5 },
};

/** Member status, derived from bot.status. Kept separate from task status. */
export const BOT_STATUS: Record<BotStatus, StatusMeta> = {
  waiting_approval: { label: "等你确认", tone: "warning", icon: AlertTriangle, order: 0 },
  working: { label: "工作中", tone: "accent", icon: Loader2, order: 1 },
  thinking: { label: "思考中", tone: "accent", icon: Sparkles, order: 2 },
  error: { label: "出错", tone: "danger", icon: XCircle, order: 3 },
  idle: { label: "空闲", tone: "success", icon: CheckCircle2, order: 4 },
  done: { label: "刚完成", tone: "success", icon: CheckCircle2, order: 5 },
  sleeping: { label: "休息中", tone: "neutral", icon: Moon, order: 6 },
};

export const taskStatusMeta = (status: TaskStatus): StatusMeta => TASK_STATUS[status];
export const botStatusMeta = (status: BotStatus): StatusMeta => BOT_STATUS[status];

/** "进行中": queued or running. A task waiting for confirmation is NOT also "running". */
export const isActiveTask = (status: TaskStatus): boolean => status === "queued" || status === "running";
export const taskNeedsYou = (status: TaskStatus): boolean => status === "waiting_approval";

/** Sort: needs-you > running > queued > failed > done > cancelled; newest first inside a status. */
export function compareTasks(a: Pick<Task, "status" | "startedAt">, b: Pick<Task, "status" | "startedAt">): number {
  const d = TASK_STATUS[a.status].order - TASK_STATUS[b.status].order;
  if (d !== 0) return d;
  return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
}

export const compareBots = (a: { status: BotStatus }, b: { status: BotStatus }): number => BOT_STATUS[a.status].order - BOT_STATUS[b.status].order;

interface WorkSummary {
  /** Tasks queued or running. */
  active: number;
  /** Distinct things waiting for the user: tasks waiting for confirmation plus pending approvals, counted once each. */
  needsYou: number;
}

/**
 * Real counts for headers like "1 项进行中 · 1 项等你确认".
 * A pending approval and its task (status waiting_approval) are one item, not two, and a task that is waiting on
 * a pending approval is not also counted as running.
 */
export function summarizeWork(tasks: Iterable<Pick<Task, "id" | "status">>, approvals: Iterable<Pick<Approval, "id" | "taskId" | "status">> = []): WorkSummary {
  const waiting = new Set<string>();
  for (const a of approvals) if (a.status === "pending") waiting.add(a.taskId ? `task:${a.taskId}` : `approval:${a.id}`);
  let active = 0;
  for (const t of tasks) {
    if (taskNeedsYou(t.status)) waiting.add(`task:${t.id}`);
    else if (isActiveTask(t.status) && !waiting.has(`task:${t.id}`)) active++;
  }
  return { active, needsYou: waiting.size };
}

/** "1 项进行中 · 1 项等你确认"; null when there is nothing to report. */
export function describeWork({ active, needsYou }: WorkSummary): string | null {
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} 项进行中`);
  if (needsYou > 0) parts.push(`${needsYou} 项等你确认`);
  return parts.length ? parts.join(" · ") : null;
}
