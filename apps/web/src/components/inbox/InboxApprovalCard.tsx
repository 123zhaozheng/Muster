import { useState } from "react";
import { Link } from "react-router";
import { Check, ShieldAlert, ShieldCheck, ShieldQuestion, TerminalSquare, X } from "lucide-react";
import type { Approval, Risk } from "@muster/protocol";
import { Badge, Button, Card, ConfirmDialog, Pebble, cn, toast, type ChipTone } from "@muster/ui";
import { BotAvatar } from "../BotAvatar";
import { hubRequest, useHub } from "../../lib/hub";
import { relativeTime } from "../../lib/format";

export const RISK_META: Record<Risk, { label: string; tone: ChipTone; bar: string; hint: string }> = {
  low: { label: "低风险", tone: "mint", bar: "from-mint to-mint-deep", hint: "只读或可轻松撤销" },
  medium: { label: "中风险", tone: "amber", bar: "from-amber to-amber-deep", hint: "会改动本机文件或安装依赖" },
  high: { label: "高风险", tone: "danger", bar: "from-danger to-danger-deep", hint: "可能删除数据或访问外部" },
};

export const RISK_ICON = { low: ShieldCheck, medium: ShieldQuestion, high: ShieldAlert } as const;

type Decision = "allow" | "deny" | "remember";

/** 收件箱里的待处理审批大卡：风险色条、会动的 Bot 头像、命令预览、允许 / 拒绝 / 总是允许。内容只来自结构化数据。 */
export function InboxApprovalCard({ approval, now }: { approval: Approval; now: number }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const task = useHub((s) => (approval.taskId ? s.model.tasks[approval.taskId] : undefined));
  const [busy, setBusy] = useState<Decision | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meta = RISK_META[approval.risk];
  const RiskIcon = RISK_ICON[approval.risk];

  const resolve = async (decision: Decision) => {
    setBusy(decision);
    try {
      await hubRequest("approval.resolve", {
        approvalId: approval.id,
        decision: decision === "deny" ? "deny" : "allow",
        ...(decision === "remember" ? { remember: true } : {}),
      });
      toast.success(decision === "deny" ? "已拒绝" : decision === "remember" ? "已允许，之后同类操作不再询问" : "已允许");
    } catch (e) {
      toast.error({ title: "操作失败", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="group relative overflow-hidden p-0 transition-shadow duration-300 hover:shadow-lift" data-risk={approval.risk}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b", meta.bar)} />
      <div className="p-5 pl-6">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            {bot ? <BotAvatar bot={{ ...bot, status: "waiting_approval" }} size={52} /> : <Pebble status="waiting_approval" size={52} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-[17px] font-semibold leading-6 text-ink">{approval.title}</h3>
              <Badge tone={meta.tone} icon={<RiskIcon className="size-3.5" />}>{meta.label}</Badge>
              {approval.unattended && <Badge tone="amber" variant="outline">无人值守触发</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-faint">
              {bot && <span>{bot.name} · {bot.engineLabel}</span>}
              {task && (
                <Link to={`/task/${task.id}`} className="text-ink-soft underline-offset-2 hover:text-coral-deep hover:underline">
                  任务：{task.title}
                </Link>
              )}
              <span>{relativeTime(approval.createdAt, now)}</span>
              <span>{meta.hint}</span>
            </div>
          </div>
        </div>

        {approval.detail && (
          <div className="mt-4 overflow-hidden rounded-2xl bg-[#2b221d] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-3.5 py-1.5 text-[11px] text-white/50">
              <TerminalSquare className="size-3.5" /> 将要执行
            </div>
            <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-6 text-[#ffe9dc]">
              <span className="select-none text-coral-glow">$ </span>
              {approval.detail}
            </pre>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {approval.risk === "high" ? (
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              trigger={<Button variant="primary" icon={<Check className="size-4" />} loading={busy === "allow"}>允许</Button>}
              title="这是一项高风险操作"
              description={<>确定允许 <b className="text-ink">{approval.title}</b> 吗？它可能无法撤销。</>}
              confirmText="仍然允许"
              tone="danger"
              onConfirm={() => resolve("allow")}
            />
          ) : (
            <Button variant="primary" icon={<Check className="size-4" />} loading={busy === "allow"} disabled={busy !== null} onClick={() => void resolve("allow")}>
              允许
            </Button>
          )}
          <Button variant="outline" icon={<X className="size-4" />} loading={busy === "deny"} disabled={busy !== null} onClick={() => void resolve("deny")}>
            拒绝
          </Button>
          {approval.risk !== "high" && (
            <Button variant="ghost" loading={busy === "remember"} disabled={busy !== null} onClick={() => void resolve("remember")} title="允许这一次，并记住同类操作">
              总是允许
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
