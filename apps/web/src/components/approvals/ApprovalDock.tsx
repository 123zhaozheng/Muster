// 审批停靠条（docs/14 §6.1）：当前对话相关的待确认请求贴在输入框正上方，一次显示一条，多条用“1/3”切换。
// 主线显示全部待确认；工单详情只显示该工单的。只有“批准一次 / 拒绝”（后端没有“本会话都允许”）。不弹窗。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Approval, ApprovalId } from "@muster/protocol";
import { Button, IconButton, cn } from "@muster/ui";
import { MemberAvatar } from "../common";
import { hubRequest, useHub } from "../../lib/hub";
import { RESOLVED_TEXT } from "../inbox/risk";

type Decision = "allow" | "deny";

/** 已处理 / 过期的请求在停靠条上停留多久再收起（ms）。 */
export const RESOLVED_LINGER_MS = 4000;

const oldestFirst = (a: Approval, b: Approval) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

export function ApprovalDock({ taskId, className }: {
  /** 只显示这个工单的请求；不传则显示全部（主线）。 */
  taskId?: string;
  className?: string;
}) {
  const approvals = useHub((s) => s.model.approvals);
  const relevant = (a: Approval) => taskId === undefined || a.taskId === taskId;
  const pending = useMemo(
    () => Object.values(approvals).filter((a) => a.status === "pending" && (taskId === undefined || a.taskId === taskId)).sort(oldestFirst).map((a) => a.id),
    [approvals, taskId],
  );

  // 停靠期间见过的请求：被处理或过期后再停留一会儿，显示结果。
  const [tracked, setTracked] = useState<ApprovalId[]>([]);
  const missing = pending.filter((id) => !tracked.includes(id));
  if (missing.length > 0) setTracked([...tracked, ...missing]);

  const items = [...tracked, ...missing].map((id) => approvals[id]).filter((a): a is Approval => !!a && relevant(a));
  const [activeId, setActiveId] = useState<ApprovalId | null>(null);
  const active = items.find((a) => a.id === activeId) ?? items.find((a) => a.status === "pending") ?? items[0];
  // 记住正在看的那条：它被处理后继续显示结果，而不是跳到下一条。
  if (active && active.id !== activeId) setActiveId(active.id);

  const resolvedKey = items.filter((a) => a.status !== "pending").map((a) => a.id).join(",");
  useEffect(() => {
    if (!resolvedKey) return;
    const ids = resolvedKey.split(",");
    const timer = setTimeout(() => setTracked((cur) => cur.filter((id) => !ids.includes(id))), RESOLVED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [resolvedKey]);

  if (!active) return null;
  const at = items.indexOf(active);
  const go = (step: number) => setActiveId(items[(at + step + items.length) % items.length]!.id);

  const switcher = items.length > 1 && (
    <span className="flex shrink-0 items-center text-xs text-fg-3">
      <IconButton label="上一条" size="sm" tooltip={false} className="size-6" onClick={() => go(-1)}>
        <ChevronLeft />
      </IconButton>
      <span aria-label={`第 ${at + 1} 条，共 ${items.length} 条`} className="tabular-nums">{at + 1}/{items.length}</span>
      <IconButton label="下一条" size="sm" tooltip={false} className="size-6" onClick={() => go(1)}>
        <ChevronRight />
      </IconButton>
    </span>
  );

  return (
    <section aria-label="待你确认" className={cn("rounded-card border border-border bg-surface px-3 py-2", className)}>
      <ApprovalBar key={active.id} approval={active} switcher={switcher} onDismiss={() => setTracked((cur) => cur.filter((id) => id !== active.id))} />
    </section>
  );
}

/** 一条请求：谁要做什么 + 命令原文（等宽，截断，点开看全文）+ 批准一次 / 拒绝。 */
function ApprovalBar({ approval, switcher, onDismiss }: { approval: Approval; switcher: ReactNode; onDismiss: () => void }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = approval.status === "pending";
  const high = approval.risk === "high";

  const resolve = async (decision: Decision) => {
    setBusy(decision);
    setError(null);
    try {
      await hubRequest("approval.resolve", { approvalId: approval.id, decision });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };
  // 高风险：第一次点击只是“确认一下”，不弹窗。
  const allow = () => (high && !confirming ? setConfirming(true) : void resolve("allow"));

  const note = !pending
    ? null
    : error
      ? <span role="alert" className="text-danger">操作失败：{error}</span>
      : submitted
        ? <span role="status">已提交，等待同步结果…</span>
        : confirming
          ? <span className="text-danger">高风险操作，可能无法撤销，再点一次确认</span>
          : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {bot && <MemberAvatar bot={bot} size={20} />}
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{approval.title}</span>
        {high && pending && <span className="shrink-0 text-xs text-danger">高风险</span>}
        {switcher}
        <Link to={`/inbox?id=${encodeURIComponent(approval.id)}`} className="shrink-0 rounded-control text-xs text-fg-3 hover:text-fg">
          详情
        </Link>
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          {approval.detail ? (
            <button
              type="button"
              aria-expanded={expanded}
              title={expanded ? undefined : approval.detail}
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "block w-full cursor-pointer rounded-control bg-surface-muted px-2 py-1.5 text-left font-mono text-xs leading-5 text-fg-2",
                expanded ? "max-h-40 overflow-y-auto whitespace-pre-wrap break-all" : "truncate",
              )}
            >
              {approval.detail}
            </button>
          ) : null}
        </div>
        {pending ? (
          <>
            <Button size="sm" variant="secondary" loading={busy === "deny"} disabled={busy !== null || submitted} onClick={() => void resolve("deny")}>
              拒绝
            </Button>
            <Button size="sm" variant={confirming ? "danger" : "primary"} loading={busy === "allow"} disabled={busy !== null || submitted} onClick={allow}>
              {confirming ? "确认批准" : "批准一次"}
            </Button>
          </>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <span role="status" className={cn("text-xs", approval.status === "allowed" ? "text-success" : approval.status === "denied" ? "text-danger" : "text-fg-3")}>
              {RESOLVED_TEXT[approval.status as keyof typeof RESOLVED_TEXT]}
              {approval.status === "expired" && "，没有执行"}
            </span>
            <IconButton label="收起" size="sm" tooltip={false} className="size-7" onClick={onDismiss}>
              <X />
            </IconButton>
          </span>
        )}
      </div>
      {note && <div className="truncate text-xs text-fg-3">{note}</div>}
    </div>
  );
}
