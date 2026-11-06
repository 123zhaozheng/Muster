import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { Button, Card, Chip, Empty, Pebble, Section } from "@muster/ui";
import { Page, PageHeader } from "../../components/layout";
import { AgentCards, useDetectedAgents } from "../../components/skills/AgentList";
import { useHub } from "../../lib/hub";

export default function SkillsPage() {
  const bots = useHub((s) => s.model.bots);
  const botSkills = useMemo(() => Object.values(bots).filter((b) => b.skills.length > 0), [bots]);
  const { state, detect } = useDetectedAgents();

  return (
    <Page>
      <PageHeader
        title="技能"
        subtitle="外部 Agent、技能与 MCP 服务器"
        leading={<Pebble shape="egg" color="butter" status="idle" size={56} halo />}
      />

      <Section
        title="外部 Agent"
        description="Muster 通过本机已安装的命令行 Agent 干活，登录由各 Agent 自己管理。"
        actions={
          <Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} loading={state.phase === "loading"} onClick={detect}>
            重新检测
          </Button>
        }
      >
        <div className="grid gap-5">
          <Card className="flex flex-wrap items-center gap-4 border-lavender/30 bg-lavender-soft/40 p-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lavender text-white shadow-soft"><Sparkles className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">原生成员 <Chip tone="lavender">内置</Chip></div>
              <p className="mt-0.5 text-sm text-ink-soft">不用安装任何命令行工具，直接使用你在「设置 · 模型」里配置的模型工作。</p>
            </div>
            <Link
              to="/settings?tab=models"
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium text-lavender-deep transition-colors hover:bg-lavender/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lavender/20"
            >
              去配置模型 <ArrowRight className="size-4" />
            </Link>
          </Card>
          <AgentCards state={state} detect={detect} />
        </div>
      </Section>

      <Section title="技能" description="SKILL.md 形式的可复用能力">
        <Card className="p-2">
          <Empty
            compact
            pebble={{ shape: "round", color: "butter", status: "sleeping" }}
            title="还没有已安装的技能"
            description="将兼容 ~/.agents/skills 与 .claude/skills"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Chip className="font-mono">~/.agents/skills</Chip>
                <Chip className="font-mono">.claude/skills</Chip>
              </div>
            }
          />
        </Card>
        {botSkills.length > 0 && (
          <Card className="mt-5 p-5">
            <div className="mb-3 text-sm font-medium text-ink">各成员当前的能力标签</div>
            <ul className="grid gap-2.5">
              {botSkills.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span className="flex w-24 items-center gap-2 text-sm font-medium">
                    <Pebble shape={b.shape} color={b.color} status={b.status} size={24} lite interactive={false} />
                    {b.name}
                  </span>
                  {b.skills.map((s) => <Chip key={s}>{s}</Chip>)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="MCP 服务器" description="让成员连接外部工具与数据源。" actions={<Chip tone="lavender">即将推出</Chip>}>
        <Card className="p-2">
          <Empty compact pebble={{ shape: "flat", color: "lilac", status: "sleeping" }} title="还没有连接 MCP 服务器" description="后续版本将支持添加并按 Bot 授权 MCP 服务器。" />
        </Card>
      </Section>
    </Page>
  );
}
