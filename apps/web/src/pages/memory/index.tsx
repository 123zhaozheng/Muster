import { Brain, Eye, FolderLock, Pencil, Sparkles, Trash2 } from "lucide-react";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Badge, Card, Empty, PageHeader, Section } from "@muster/ui";
import { Page, PageBody, PageGrid } from "../../components/layout";
import { useHub } from "../../lib/hub";

const REMEMBER = [
  { icon: Sparkles, tone: "bg-coral-soft text-coral-deep", title: "你的偏好", text: "常用的语言、代码风格、汇报习惯，下次不用再说一遍。" },
  { icon: FolderLock, tone: "bg-lavender-soft text-lavender-deep", title: "项目背景", text: "仓库的约定、常用命令、踩过的坑，让分发更准。" },
  { icon: Brain, tone: "bg-mint-soft text-mint-deep", title: "做过的决定", text: "你批准或拒绝过什么，以及背后的原因。" },
] as const;

const MANAGE = [
  { icon: Eye, title: "随时查看", text: "每一条记忆都能看到来源和时间，没有黑箱。" },
  { icon: Pencil, title: "可以修改", text: "记错了就直接改，改完立刻生效。" },
  { icon: Trash2, title: "一键删除", text: "单条删除或整体清空，删除后不会再被引用。" },
] as const;

export default function MemoryPage() {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const name = pip?.name ?? "Pip";
  return (
    <Page>
      <PageHeader
        title="记忆"
        subtitle={`${name} 记住了什么，你说了算`}
        pebble={{ shape: pip?.shape ?? "round", color: pip?.color ?? "cream", status: "thinking", size: 48 }}
        meta={<Badge tone="lavender" variant="outline">即将推出</Badge>}
      />
      <PageBody
        main={
          <>
            <Section title="已记住的内容" card>
              <Empty
                pebble={{ shape: pip?.shape ?? "round", color: pip?.color ?? "cream", status: "sleeping" }}
                title={`${name} 会记住你的偏好，你可以查看、修改、删除`}
                description="记忆功能即将推出。目前还没有任何记忆被保存。"
              />
            </Section>
            <Section title="会记住什么" description="只记对做事有帮助的内容，不会偷偷读取其他文件。">
              <PageGrid min={240}>
                {REMEMBER.map(({ icon: Icon, tone, title, text }) => (
                  <Card key={title} hoverable className="p-5">
                    <span className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
                    <div className="mt-3 text-[15px] font-semibold text-ink">{title}</div>
                    <p className="mt-1 text-sm leading-6 text-ink-soft">{text}</p>
                  </Card>
                ))}
              </PageGrid>
            </Section>
          </>
        }
        rail={
          <Card className="muster-gradient-brand-soft p-5">
            <h3 className="text-[15px] font-semibold text-ink">如何管理记忆</h3>
            <ul className="mt-3 grid gap-4">
              {MANAGE.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/70 text-coral-deep shadow-soft"><Icon className="size-4" /></span>
                  <div>
                    <div className="text-sm font-medium text-ink">{title}</div>
                    <div className="text-sm leading-6 text-ink-soft">{text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        }
      />
    </Page>
  );
}
