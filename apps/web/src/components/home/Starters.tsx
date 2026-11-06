import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { MAIN_BOT_ID, type Bot } from "@muster/protocol";
import { cn } from "@muster/ui";
import { MemberAvatar } from "../common";
import { useHub } from "../../lib/hub";
import { useServerNow } from "./serverClock";
import { greetingFor } from "./time";

/** 空主线的建议（最多 4 条）：点一下只把文字填进输入框，由用户修改后再发。 */
const STARTERS: { label: string; text: string }[] = [
  { label: "分头干活", text: "shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克" },
  { label: "调研对比", text: "让小探调研一下主流向量数据库的差异，整理成一张对比表" },
  { label: "每日简报", text: "每天早上 9 点让小探给我一份晨间简报" },
  { label: "看看进度", text: "现在各位成员手上都有什么任务？有卡住的吗？" },
];

const FALLBACK_PIP: Pick<Bot, "name" | "shape" | "color" | "status"> = { name: "Pip", shape: "round", color: "cream", status: "idle" };

/** 空主线：小 Pip + 一句问候 + 至多 4 个建议胶囊。放在消息区底部，贴着输入框。 */
export function Starters({ onPick, className }: { onPick: (text: string) => void; className?: string }) {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]) ?? FALLBACK_PIP;
  const now = useServerNow();
  return (
    <section aria-label="开始" className={cn("flex flex-col items-start gap-3", className)}>
      <div className="flex items-center gap-2.5">
        <MemberAvatar bot={pip} size={32} />
        <p className="text-body text-fg">{greetingFor(new Date(now).getHours())}，有什么要交给团队的？</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {STARTERS.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              title={p.text}
              onClick={() => onPick(p.text)}
              className="cursor-pointer rounded-full bg-surface-muted px-4 py-1.5 text-sm text-fg-2 transition-colors hover:bg-accent-surface hover:text-fg"
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 未配置任何模型时的一行轻提示。 */
export function ModelHint() {
  return (
    <div role="region" aria-label="模型未配置" className="flex items-center gap-2 rounded-card bg-surface-muted px-4 py-2.5 text-sm text-fg-2">
      <span className="min-w-0 flex-1">还没有配置模型：Pip 现在只能按规则分发，内置成员也还不能干活。</span>
      <Link to="/settings?tab=models" className="inline-flex shrink-0 items-center gap-0.5 rounded-control font-medium text-accent hover:text-accent-hover">
        设置 · 模型与连接
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
