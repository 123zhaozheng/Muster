import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Bot } from "@muster/protocol";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Button, ConfirmDialog, StatCard, toast } from "@muster/ui";
import { Activity, Hand, Plus, Users, Wallet } from "lucide-react";
import { hubRequest, useHub } from "../../lib/hub";
import { Page, PageGrid, PageHeader } from "../../components/layout";
import { AddMemberCard } from "../../components/crew/AddMemberCard";
import { CrewCard } from "../../components/crew/CrewCard";
import { MemberSheet, type SheetTarget } from "../../components/crew/MemberSheet";

export default function CrewPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const botMap = useHub((s) => s.model.bots);
  const taskMap = useHub((s) => s.model.tasks);
  const approvalMap = useHub((s) => s.model.approvals);
  // Main bot first, the rest in roster order.
  const bots = useMemo(() => Object.values(botMap).sort((a, b) => Number(b.id === MAIN_BOT_ID) - Number(a.id === MAIN_BOT_ID)), [botMap]);
  const tasks = useMemo(() => Object.values(taskMap), [taskMap]);

  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  // 命令面板 / 其他入口：/crew?new=1 直接打开向导
  useEffect(() => {
    if (params.get("new") === "1") {
      setSheet({ mode: "create" });
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const stats = useMemo(() => {
    const online = bots.filter((b) => b.status !== "sleeping").length;
    const working = bots.filter((b) => b.status === "working" || b.status === "thinking").length;
    const pending = Object.values(approvalMap).filter((a) => a.status === "pending").length;
    const cost = bots.reduce((sum, b) => sum + b.costWeekUsd, 0);
    return { online, working, pending, cost };
  }, [bots, approvalMap]);

  async function remove(bot: Bot) {
    try {
      await hubRequest("bot.remove", { botId: bot.id });
      toast.success(`${bot.name} 已离开团队`);
    } catch (e) {
      toast.error({ title: "删除失败", description: e instanceof Error ? e.message : String(e) });
      throw e; // 让确认框保持打开
    }
  }

  return (
    <Page>
      <PageHeader
        title="团队"
        subtitle={`你的 AI 团队共 ${bots.length} 位成员，随时待命，协同更高效`}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setSheet({ mode: "create" })}>
            新建成员
          </Button>
        }
      />

      <PageGrid min={220} aria-label="团队概览">
        <StatCard label="在线" value={stats.online} icon={<Users />} tone="mint" suffix={` / ${bots.length}`} hint="没在睡觉的成员" />
        <StatCard label="工作中" value={stats.working} icon={<Activity />} tone="lavender" hint="正在思考或干活" />
        <StatCard label="等你审批" value={stats.pending} icon={<Hand />} tone="amber" hint={stats.pending ? "点这里去处理" : "没有待处理的"} onClick={() => navigate("/inbox")} />
        <StatCard label="本周花费" value={stats.cost} icon={<Wallet />} tone="coral" prefix="$" decimals={2} hint="全部成员合计" />
      </PageGrid>

      <PageGrid min={290} aria-label="成员列表">
        {bots.map((b) => (
          <CrewCard key={b.id} bot={b} tasks={tasks} fresh={b.id === fresh} onEdit={(bot) => setSheet({ mode: "edit", bot })} onDelete={setDeleting} />
        ))}
        <AddMemberCard onClick={() => setSheet({ mode: "create" })} />
      </PageGrid>

      <MemberSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onSaved={(bot, kind) => {
          setSheet(null);
          if (kind === "created") setFresh(bot.id);
        }}
        onDelete={(bot) => {
          setSheet(null);
          setDeleting(bot);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="danger"
        title={`删除 ${deleting?.name ?? ""}？`}
        description="TA 会从团队中移除，设置也会一并删除。还有进行中任务的成员无法删除。"
        confirmText="删除"
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </Page>
  );
}
