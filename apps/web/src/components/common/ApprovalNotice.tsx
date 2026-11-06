import { Link } from "react-router";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { Approval } from "@muster/protocol";
import { cn } from "@muster/ui";

const RESOLVED: Record<Exclude<Approval["status"], "pending">, string> = { allowed: "已允许", denied: "已拒绝", expired: "已过期" };

/**
 * 对话里的确认提示：一行琥珀色，没有按钮；决定在输入框上方的审批条里做（“在下方确认”），收件箱链接只作次要入口。
 * 文案来自 approval.title（守护进程按结构化数据生成）。
 */
export function ApprovalNotice({ approval, className }: { approval: Pick<Approval, "id" | "title" | "status">; className?: string }) {
  const resolved = approval.status === "pending" ? null : RESOLVED[approval.status];
  return (
    <div
      className={cn(
        "flex max-w-[40em] items-center gap-2.5 rounded-control px-3 py-2 text-sm",
        resolved ? "bg-surface-muted text-fg-2" : "bg-warning-surface text-fg",
        className,
      )}
    >
      <AlertTriangle aria-hidden className={cn("size-4 shrink-0", resolved ? "text-fg-3" : "text-warning")} />
      <span className="min-w-0 flex-1 truncate">
        {approval.title}
        <span className="text-fg-3"> · {resolved ?? "在下方确认"}</span>
      </span>
      <Link
        to={`/inbox?id=${encodeURIComponent(approval.id)}`}
        aria-label={`在收件箱查看：${approval.title}`}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-control text-caption text-fg-3 hover:text-accent"
      >
        查看
        <ChevronRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
