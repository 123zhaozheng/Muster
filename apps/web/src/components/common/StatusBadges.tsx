import type { BotStatus, TaskStatus } from "@muster/protocol";
import { StatusBadge } from "@muster/ui";
import { botStatusMeta, taskStatusMeta } from "../../lib/status";

/** Task status: dot + text, colour from lib/status. */
export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = taskStatusMeta(status);
  return (
    <StatusBadge tone={m.tone} pulse={status === "running"} className={className}>
      {m.label}
    </StatusBadge>
  );
}

/** Member status (bot.status): dot + text, colour from lib/status. */
export function BotStatusBadge({ status, className }: { status: BotStatus; className?: string }) {
  const m = botStatusMeta(status);
  return (
    <StatusBadge tone={m.tone} pulse={status === "working" || status === "thinking" || status === "waiting_approval"} className={className}>
      {m.label}
    </StatusBadge>
  );
}
