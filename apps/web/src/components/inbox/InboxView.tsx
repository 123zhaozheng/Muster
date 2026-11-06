import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Approval } from "@muster/protocol";
import { Badge, CountBadge, EmptyState, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@muster/ui";
import { ListDetail } from "../layout";
import { useHub } from "../../lib/hub";
import { relativeTime } from "../../lib/format";
import { useNow } from "../../shell/useNow";
import { MemberAvatar } from "../common";
import { ApprovalDetail } from "./ApprovalDetail";
import { RESOLVED_TEXT, RISK_META } from "./risk";

type Tab = "pending" | "resolved";

const byTime = (a: Approval) => a.resolvedAt ?? a.createdAt;
const newestFirst = (a: Approval, b: Approval) => (byTime(a) < byTime(b) ? 1 : -1);

/** Master-detail inbox: pending / resolved list on the left, the selected approval on the right (`?id=` selects). */
export function InboxView() {
  const approvals = useHub((s) => s.model.approvals);
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id");
  const [tab, setTab] = useState<Tab>("pending");

  const { pending, resolved } = useMemo(() => {
    const all = Object.values(approvals).sort(newestFirst);
    return { pending: all.filter((a) => a.status === "pending"), resolved: all.filter((a) => a.status !== "pending") };
  }, [approvals]);

  const requested = selectedId ? approvals[selectedId] : undefined;
  const [followed, setFollowed] = useState<string | null>(null);
  if (requested && followed !== requested.id) {
    setFollowed(requested.id);
    setTab(requested.status === "pending" ? "pending" : "resolved");
  }

  const shown = requested ?? (selectedId ? undefined : (tab === "pending" ? pending : resolved)[0]);

  const list = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="px-4 pt-4">
      <TabsList className="w-full">
        <TabsTrigger value="pending">待处理<CountBadge count={pending.length} /></TabsTrigger>
        <TabsTrigger value="resolved">已处理{resolved.length > 0 && <span className="text-fg-3 tabular-nums">{resolved.length}</span>}</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="mt-3 outline-none">
        {pending.length === 0 ? (
          <EmptyState compact title="没有等你确认的事" description="成员要做的敏感操作会先停在这里，等你决定。" />
        ) : (
          <ApprovalList items={pending} selectedId={shown?.id} now={now} />
        )}
      </TabsContent>
      <TabsContent value="resolved" className="mt-3 outline-none">
        {resolved.length === 0 ? (
          <EmptyState compact title="还没有处理过的审批" description="你允许、拒绝或过期的请求会记录在这里。" />
        ) : (
          <ApprovalList items={resolved} selectedId={shown?.id} now={now} />
        )}
      </TabsContent>
    </Tabs>
  );

  const detail = shown ? (
    <ApprovalDetail key={shown.id} approval={shown} now={now} />
  ) : (
    <EmptyState
      className="h-full justify-center"
      title={selectedId ? "找不到这条审批" : "没有需要处理的审批"}
      description={selectedId ? "它可能已被清理，或链接已失效。" : "有新的请求时会出现在左侧列表。"}
      action={selectedId ? <Link to="/inbox" className="text-sm font-medium text-accent hover:text-accent-hover">回到列表</Link> : undefined}
    />
  );

  return <ListDetail list={list} detail={detail} showDetail={Boolean(selectedId)} onBack={() => setParams({})} backLabel="返回列表" listWidth={360} />;
}

function ApprovalList({ items, selectedId, now }: { items: Approval[]; selectedId: string | undefined; now: number }) {
  return (
    <ul className="grid gap-1 pb-4">
      {items.map((a) => (
        <li key={a.id}>
          <ApprovalRow approval={a} selected={a.id === selectedId} now={now} />
        </li>
      ))}
    </ul>
  );
}

function ApprovalRow({ approval, selected, now }: { approval: Approval; selected: boolean; now: number }) {
  const bot = useHub((s) => s.model.bots[approval.botId]);
  const pending = approval.status === "pending";
  const risk = RISK_META[approval.risk];
  return (
    <Link
      to={`/inbox?id=${encodeURIComponent(approval.id)}`}
      aria-current={selected ? "true" : undefined}
      className={cn("flex items-start gap-3 rounded-control px-3 py-2.5 transition-colors hover:bg-surface-muted", selected && "bg-accent-surface hover:bg-accent-surface")}
    >
      {bot && <MemberAvatar bot={bot} size={40} />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium text-fg">{approval.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
          {pending ? <Badge tone={risk.tone} size="sm">{risk.label}</Badge> : <span>{RESOLVED_TEXT[approval.status as keyof typeof RESOLVED_TEXT]}</span>}
          <span>{relativeTime(byTime(approval), now)}</span>
        </span>
      </span>
    </Link>
  );
}
