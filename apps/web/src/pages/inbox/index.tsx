import { CheckCheck } from "lucide-react";
import { MAIN_BOT_ID } from "@muster/protocol";
import { CountBadge, PageHeader as UiPageHeader } from "@muster/ui";
import { InboxView } from "../../components/inbox/InboxView";
import { Page } from "../../components/layout";
import { useHub } from "../../lib/hub";

export default function InboxPage() {
  const pendingCount = useHub((s) => Object.values(s.model.approvals).filter((a) => a.status === "pending").length);
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  return (
    <Page>
      <UiPageHeader
        title="收件箱"
        meta={<CountBadge count={pendingCount} tone="amber" className="!h-6 !min-w-6 !text-xs" />}
        subtitle={pendingCount > 0 ? `有 ${pendingCount} 项需要你处理` : "所有审批都在这里，没有需要你处理的事项"}
        pebble={{ shape: pip?.shape ?? "round", color: pip?.color ?? "cream", status: pendingCount > 0 ? "waiting_approval" : "done", size: 48 }}
        actions={pendingCount === 0 ? <span className="inline-flex items-center gap-1.5 text-sm text-mint-deep"><CheckCheck className="size-4" />已全部处理</span> : undefined}
      />
      <InboxView />
    </Page>
  );
}
