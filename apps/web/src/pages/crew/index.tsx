import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Bot } from "@muster/protocol";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Button, ConfirmDialog, PageHeader, toast } from "@muster/ui";
import { Info, Plus } from "lucide-react";
import { hubRequest, useHub } from "../../lib/hub";
import { Page } from "../../components/layout";
import { MemberCard } from "../../components/crew/MemberCard";
import { MemberSheet, type SheetTarget } from "../../components/crew/MemberSheet";
import { PipRow } from "../../components/crew/PipRow";

export default function CrewPage() {
  const [params, setParams] = useSearchParams();
  const botMap = useHub((s) => s.model.bots);
  const taskMap = useHub((s) => s.model.tasks);
  const pip = botMap[MAIN_BOT_ID];
  const members = useMemo(() => Object.values(botMap).filter((b) => b.id !== MAIN_BOT_ID && b.kind !== "main"), [botMap]);
  const tasks = useMemo(() => Object.values(taskMap), [taskMap]);

  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);

  // Other entry points (search, empty states) open the add drawer with /crew?new=1.
  useEffect(() => {
    if (params.get("new") === "1") {
      setSheet({ mode: "create" });
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  async function remove(bot: Bot) {
    try {
      await hubRequest("bot.remove", { botId: bot.id });
      toast.success(`${bot.name} 已离开团队`);
    } catch (e) {
      toast.error({ title: "删除失败", description: e instanceof Error ? e.message : String(e) });
      throw e; // keeps the confirm dialog open
    }
  }

  return (
    <Page>
      <PageHeader
        title="你的 AI 小队"
        subtitle="Pip 负责协调，成员各有所长"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setSheet({ mode: "create" })}>
            添加成员
          </Button>
        }
      />

      {pip && <PipRow bot={pip} onEdit={(bot) => setSheet({ mode: "edit", bot })} />}

      <section aria-label="成员" className="space-y-3">
        <h2 className="text-section font-semibold text-fg">成员 · {members.length}</h2>
        {members.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {members.map((b) => (
              <MemberCard key={b.id} bot={b} tasks={tasks} onConfigure={(bot) => setSheet({ mode: "edit", bot })} />
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-border bg-surface p-5 text-sm text-fg-2">还没有成员。添加一位成员，Pip 就能把合适的活儿交给 TA。</p>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-card border border-border px-5 py-4">
        <Info size={18} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
        <div>
          <h2 className="text-body font-semibold text-fg">协作方式</h2>
          <p className="text-sm text-fg-2">交给 Pip 自动安排，也可以在对话中 @ 指定成员。</p>
        </div>
      </div>

      <MemberSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onSaved={() => setSheet(null)}
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
