import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Section, Tabs, TabsContent, TabsList, TabsTrigger } from "@muster/ui";
import { MemberAvatar } from "../../components/common";
import { Page } from "../../components/layout";
import { AgentRows, useDetectedAgents } from "../../components/skills/AgentRows";
import { useHub } from "../../lib/hub";

export default function SkillsPage() {
  const bots = useHub((s) => s.model.bots);
  const botSkills = useMemo(() => Object.values(bots).filter((b) => b.skills.length > 0), [bots]);
  const { state, detect } = useDetectedAgents();

  return (
    <Page>
      <PageHeader title="技能" subtitle="外部 Agent、SKILL.md 技能与 MCP 服务器。" />
      <Tabs defaultValue="installed" className="mt-4">
        <TabsList>
          <TabsTrigger value="installed">已安装</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="mt-6 grid gap-8">
          <Section
            title="外部 Agent"
            description="Muster 通过本机已安装的命令行 Agent 干活，登录由各 Agent 自己管理。"
            actions={
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={state.phase === "loading"} onClick={detect}>
                重新检测
              </Button>
            }
          >
            <div className="grid gap-3">
              <Card className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-muted text-fg-2"><Sparkles className="size-[18px]" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-fg">原生成员 <Badge tone="neutral">内置</Badge></div>
                  <p className="mt-0.5 text-sm text-fg-2">不用安装任何命令行工具，直接使用你在「设置 · 模型与连接」里配置的模型工作。</p>
                </div>
                <Link
                  to="/settings?tab=models"
                  className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  去配置模型 <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Card>
              <AgentRows state={state} detect={detect} />
            </div>
          </Section>

          <Section title="技能" description="SKILL.md 形式的可复用能力。">
            <Card>
              <EmptyState
                compact
                pebble={{ shape: "round", color: "cream", status: "sleeping" }}
                title="还没有已安装的技能"
                description="放在 ~/.agents/skills 或 .claude/skills 的 SKILL.md 技能，将在后续版本中被识别。"
              />
            </Card>
            {botSkills.length > 0 && (
              <Card className="mt-3 p-0">
                <div className="border-b border-border px-5 py-3 text-sm font-medium text-fg">各成员当前的能力标签</div>
                <ul className="divide-y divide-border">
                  {botSkills.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="flex w-32 items-center gap-2 text-sm font-medium text-fg">
                        <MemberAvatar bot={b} size={28} />
                        {b.name}
                      </span>
                      <span className="flex flex-wrap gap-1.5">{b.skills.map((s) => <Badge key={s}>{s}</Badge>)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          <Section title="MCP 服务器" description="让成员连接外部工具与数据源。" actions={<Badge tone="neutral">即将推出</Badge>}>
            <Card>
              <EmptyState compact pebble={{ shape: "flat", color: "lilac", status: "sleeping" }} title="还没有连接 MCP 服务器" description="后续版本将支持添加并按成员授权 MCP 服务器。" />
            </Card>
          </Section>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
