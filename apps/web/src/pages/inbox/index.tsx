import { PageHeader } from "@muster/ui";
import { InboxView } from "../../components/inbox/InboxView";
import { useHub } from "../../lib/hub";

export default function InboxPage() {
  const pendingCount = useHub((s) => Object.values(s.model.approvals).filter((a) => a.status === "pending").length);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 py-4 md:px-8">
        <PageHeader title="需要你" subtitle={pendingCount > 0 ? `${pendingCount} 项等你确认` : "没有等你确认的事"} />
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        <InboxView />
      </div>
    </div>
  );
}
