import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Check, CheckCircle2, Copy, XCircle } from "lucide-react";
import type { Approval } from "@muster/protocol";
import { Badge, Button, Card, ConfirmDialog, DescriptionList, IconButton, Section, cn, toast } from "@muster/ui";
import { MemberAvatar, TaskStatusBadge } from "../common";
import { hubRequest, useHub } from "../../lib/hub";
import { relativeTime } from "../../lib/format";
import { RESOLVED_TEXT, RISK_META } from "./risk";

type Decision = "allow" | "deny";

const fullTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** One approval in full: who asked, which task, what will run (verbatim command), where, how risky, and the decision. */
export function ApprovalDetail({ approval, now }: { approval: Approval; now: number }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const task = useHub((s) => (approval.taskId ? s.model.tasks[approval.taskId] : undefined));
  const [busy, setBusy] = useState<Decision | null>(null);
  const [submitted, setSubmitted] = useState<Decision | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const risk = RISK_META[approval.risk];
  const RiskIcon = risk.icon;
  const pending = approval.status === "pending";

  const resolve = async (decision: Decision) => {
    setBusy(decision);
    try {
      await hubRequest("approval.resolve", { approvalId: approval.id, decision });
      setSubmitted(decision);
      toast.success(decision === "allow" ? "已允许这一次" : "已拒绝");
    } catch (e) {
      toast.error({ title: "操作失败", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const copyCommand = () => {
    void navigator.clipboard?.writeText(approval.detail ?? "");
    toast.success("已复制");
  };

  return (
    <article className="mx-auto flex max-w-[720px] flex-col gap-6 px-5 py-6 md:px-8" aria-label="审批详情">
      <header className="flex items-start gap-4">
        {bot && <MemberAvatar bot={bot} size={48} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold leading-snug text-fg">{approval.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-2">
            {bot && <span>{bot.name} · {bot.engineLabel}</span>}
            <span>{relativeTime(approval.createdAt, now)}请求</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={risk.tone} icon={<RiskIcon className="size-3.5" />}>{risk.label}</Badge>
            {approval.unattended && <Badge tone="warning" variant="outline">无人值守触发</Badge>}
          </div>
        </div>
      </header>

      {!pending && <ResolvedNotice approval={approval} now={now} />}

      <Section title="将要执行">
        {approval.detail ? (
          <div className="overflow-hidden rounded-card border border-border bg-surface-muted">
            <div className="flex items-center justify-between border-b border-border px-3 py-1">
              <span className="text-xs text-fg-3">命令原文</span>
              <IconButton label="复制命令" size="sm" onClick={copyCommand}><Copy /></IconButton>
            </div>
            <pre className="overflow-x-auto px-3 py-3 font-mono text-[13px] leading-6 text-fg">{approval.detail}</pre>
          </div>
        ) : (
          <p className="text-sm text-fg-2">这次请求没有附带命令内容。</p>
        )}
      </Section>

      <Section title="详情">
        <Card className="p-5">
          <DescriptionList
            columns={1}
            items={[
              {
                label: "来自任务",
                value: task ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/task/${task.id}`} className="text-accent hover:text-accent-hover hover:underline">{task.title}</Link>
                    <TaskStatusBadge status={task.status} />
                  </span>
                ) : (
                  "没有关联的任务"
                ),
              },
              ...(task?.cwd ? [{ label: "工作目录", value: task.cwd, mono: true, copyable: true }] : []),
              { label: "风险", value: `${risk.label} · ${risk.hint}` },
              { label: "请求时间", value: fullTime(approval.createdAt) },
            ]}
          />
        </Card>
      </Section>

      {pending && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
          {approval.risk === "high" ? (
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              trigger={<Button variant="primary" icon={<Check className="size-4" />} loading={busy === "allow"} disabled={busy !== null || submitted !== null}>仅允许这一次</Button>}
              title="这是一项高风险操作"
              description={<>确定允许 <b className="text-fg">{approval.title}</b> 吗？它可能无法撤销。</>}
              confirmText="仍然允许"
              tone="danger"
              onConfirm={() => resolve("allow")}
            />
          ) : (
            <Button variant="primary" icon={<Check className="size-4" />} loading={busy === "allow"} disabled={busy !== null || submitted !== null} onClick={() => void resolve("allow")}>
              仅允许这一次
            </Button>
          )}
          <Button variant="secondary" icon={<XCircle className="size-4" />} loading={busy === "deny"} disabled={busy !== null || submitted !== null} onClick={() => void resolve("deny")}>
            拒绝
          </Button>
          {submitted && <span className="text-caption text-fg-2">已提交，等待同步结果…</span>}
        </div>
      )}
    </article>
  );
}

function ResolvedNotice({ approval, now }: { approval: Approval; now: number }) {
  const status = approval.status as keyof typeof RESOLVED_TEXT;
  const Icon = status === "allowed" ? CheckCircle2 : status === "denied" ? XCircle : AlertTriangle;
  const text = RESOLVED_TEXT[status];
  const when = approval.resolvedAt ? relativeTime(approval.resolvedAt, now) : "";
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-card border px-4 py-3 text-sm",
        status === "allowed" && "border-success/25 bg-success-surface text-success",
        status === "denied" && "border-danger/25 bg-danger-surface text-danger",
        status === "expired" && "border-border bg-surface-muted text-fg-2",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="font-medium">{text}</span>
      {when && <span className="text-fg-2">· {when}</span>}
      {status === "expired" && <span className="text-fg-2">· 这次请求没有被执行</span>}
    </div>
  );
}
