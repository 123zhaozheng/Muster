import type { Approval } from "@muster/protocol";
import { Button, Card, Chip, cn } from "@muster/ui";
import { hubRequest, useHub } from "../lib/hub";
import { BotAvatar } from "./BotAvatar";

const RISK = { low: ["低风险", "mint"], medium: ["中风险", "amber"], high: ["高风险", "danger"] } as const;

/** Native approval card. Content comes from structured data only (never model text). Shared by home / inbox / workbench. */
export function ApprovalCard({ approval, compact, className }: { approval: Approval; compact?: boolean; className?: string }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const [riskLabel, riskTone] = RISK[approval.risk];
  const pending = approval.status === "pending";
  const resolve = (decision: "allow" | "deny") => void hubRequest("approval.resolve", { approvalId: approval.id, decision });
  return (
    <Card className={cn("p-3", className)}>
      <div className="flex items-center gap-2">
        {bot && <BotAvatar bot={bot} size={compact ? 28 : 36} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{approval.title}</div>
          {approval.detail && <div className="mt-0.5 truncate font-mono text-xs text-ink-soft">{approval.detail}</div>}
        </div>
        <Chip tone={riskTone}>{riskLabel}</Chip>
      </div>
      {pending ? (
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" className="flex-1" onClick={() => resolve("allow")}>允许</Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => resolve("deny")}>拒绝</Button>
        </div>
      ) : (
        <div className="mt-2 text-xs text-ink-faint">{approval.status === "allowed" ? "已允许" : approval.status === "denied" ? "已拒绝" : "已过期"}</div>
      )}
    </Card>
  );
}
