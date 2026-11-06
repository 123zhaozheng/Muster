import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Section, SettingsRow } from "@muster/ui";
import { MemberAvatar } from "../common";
import { useHub } from "../../lib/hub";

const linkClass = "inline-flex items-center gap-1 rounded-control text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function CrewSection() {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const memberCount = useHub((s) => Object.keys(s.model.bots).filter((id) => id !== MAIN_BOT_ID).length);
  const router = useHub((s) => s.model.modelSettings?.router);

  return (
    <div className="grid gap-8">
      <Section title="Pip" description="协调者：理解你的话，把活分给合适的成员。" card>
        {pip && (
          <div className="flex items-center gap-3 pb-4">
            <MemberAvatar bot={pip} size={40} />
            <div className="min-w-0">
              <div className="text-body font-semibold text-fg">{pip.name}</div>
              {pip.tagline && <div className="truncate text-sm text-fg-2">{pip.tagline}</div>}
            </div>
          </div>
        )}
        <SettingsRow label="Pip 的模型" description={router ? "用于理解你的话、分派任务和闲聊。" : "未设置时，Pip 只能按规则路由：点名成员才会分派，不会闲聊。"}>
          <span className="font-mono text-sm text-fg">{router ? `${router.provider} / ${router.modelId}` : "未设置"}</span>
          <Link to="/settings?tab=models" className={linkClass}>更改</Link>
        </SettingsRow>
      </Section>

      <Section title="成员" description="添加、配置或移除成员，都在团队页里。" card>
        <SettingsRow label="团队成员" description={`除 Pip 外，当前有 ${memberCount} 位成员。`}>
          <Link to="/crew" className={linkClass}>
            前往团队 <ArrowRight className="size-4" aria-hidden />
          </Link>
        </SettingsRow>
      </Section>
    </div>
  );
}
