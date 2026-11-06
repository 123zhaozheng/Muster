import { useNavigate } from "react-router";
import { Briefcase, CalendarClock, Code2, GitPullRequest, KeyRound, Search, Users, type LucideIcon } from "lucide-react";
import type { Bot } from "@muster/protocol";
import { Button, Pebble, cn, type ChipTone } from "@muster/ui";

interface Example {
  title: string;
  text: string;
  icon: LucideIcon;
  tone: ChipTone;
}

/** “试试这样说”：覆盖编程、研究、办公、定时、PR 场景。 */
export const EXAMPLE_PROMPTS: Example[] = [
  { title: "分头干活", text: "shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克", icon: Users, tone: "coral" },
  { title: "编程", text: "让小码给 utils 目录补上单元测试，跑通以后告诉我结果", icon: Code2, tone: "mint" },
  { title: "研究", text: "让小探调研一下主流向量数据库的差异，整理成一张对比表", icon: Search, tone: "sky" },
  { title: "办公", text: "让小文把这周的会议纪要整理成周报，周五之前提醒我发出去", icon: Briefcase, tone: "lavender" },
  { title: "定时任务", text: "每天早上 9 点让小探给我一份晨间简报", icon: CalendarClock, tone: "amber" },
  { title: "盯着 PR", text: "shop-api 有新 PR 打开时，让阿克先看一遍并告诉我", icon: GitPullRequest, tone: "coral" },
];

const TILE: Record<string, string> = {
  coral: "bg-coral-soft text-coral-deep",
  mint: "bg-mint-soft text-mint-deep",
  sky: "bg-sky-soft text-sky-deep",
  lavender: "bg-lavender-soft text-lavender-deep",
  amber: "bg-amber-soft text-amber-deep",
};

/** 未配置任何模型时的引导卡：链接到 设置 · 模型。 */
export function ModelSetupCard({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <div
      role="region"
      aria-label="模型未配置"
      className={cn(
        "muster-gradient-brand-soft flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-coral/20 shadow-soft",
        compact ? "px-4 py-3" : "px-5 py-4",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/80 text-coral-deep shadow-soft"><KeyRound className="size-5" aria-hidden /></span>
      <div className="min-w-[200px] flex-1">
        <div className="text-sm font-semibold">还没有配置模型</div>
        <div className="mt-0.5 text-sm text-ink-soft">
          {compact ? "配置后 Pip 才能理解你的话，内置成员也才能干活。" : "现在 Pip 只能按规则分发。接入一个模型（DeepSeek、Kimi、OpenAI、本地 Ollama 都行），它才能理解你说的话、陪你聊天，内置成员也才能真正干活。"}
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate("/settings?tab=models")}>去配置模型</Button>
    </div>
  );
}

/** 主线为空时的欢迎态：大 Pip + 引导卡 + 示例卡片网格。 */
export function Welcome({ bot, onPick, needsModel }: { bot: Pick<Bot, "shape" | "color" | "status" | "name">; onPick: (text: string) => void; needsModel: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 py-6 text-center">
      <div className="relative grid place-items-center">
        <Pebble shape={bot.shape} color={bot.color} status={bot.status === "sleeping" ? "idle" : bot.status} size={132} halo title={bot.name} />
      </div>
      <div>
        <div className="muster-text-gradient text-[28px] font-semibold leading-9">嗨，我是 {bot.name}</div>
        <div className="mt-1.5 text-sm text-ink-soft">告诉我要做什么，我会把活儿分给合适的伙伴</div>
      </div>
      {needsModel && <div className="w-full text-left"><ModelSetupCard /></div>}
      <div className="w-full text-left">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-soft">
          试试这样说<span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" aria-hidden />
        </div>
        <div className="muster-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => onPick(p.text)}
              className="muster-glass-2 hover-lift group flex cursor-pointer flex-col gap-2 rounded-card p-4 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-coral/50"
            >
              <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium", TILE[p.tone])}>
                <p.icon className="size-3.5" aria-hidden />
                {p.title}
              </span>
              <span className="text-sm leading-relaxed text-ink">{p.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
