import { useState } from "react";
import { ArrowRight, Bot as BotIcon, Brain, Cpu, Sparkles, Wand2 } from "lucide-react";
import type { BotColor, BotStatus, PebbleShape } from "@muster/protocol";
import { Badge, Card, Field, Input, Pebble, STATUS_LABEL, Segmented, cn } from "@muster/ui";

export const STEP_TITLES = ["欢迎", "形象", "模型", "Agent", "完成"] as const;
export const LAST_STEP = STEP_TITLES.length - 1;

export const ONBOARDED_KEY = "muster.onboarded";
/** 主 Bot 的名字与形象。完成时同时写入本机（兜底）并通过 bot.update 同步给 daemon。 */
export const PROFILE_KEY = "muster.mainBotProfile";

export const SHAPES: { value: PebbleShape; label: string }[] = [
  { value: "round", label: "圆圆" },
  { value: "square", label: "方方" },
  { value: "blob", label: "软软" },
  { value: "egg", label: "蛋蛋" },
  { value: "flat", label: "扁扁" },
];
export const COLORS: { value: BotColor; label: string }[] = [
  { value: "cream", label: "奶油" },
  { value: "mint", label: "薄荷" },
  { value: "peach", label: "蜜桃" },
  { value: "sky", label: "天空" },
  { value: "lilac", label: "丁香" },
  { value: "rose", label: "玫瑰" },
  { value: "butter", label: "奶黄" },
];

export interface Profile {
  name: string;
  shape: PebbleShape;
  color: BotColor;
}

/** 步骤指示器：已完成的连接线会从左向右填满，当前步骤的圆点带扩散光环。 */
export function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="mx-auto flex w-full max-w-2xl items-center" aria-label="步骤">
      {STEP_TITLES.map((title, i) => (
        <li key={title} className={cn("flex items-center", i < LAST_STEP && "flex-1")} aria-current={i === step ? "step" : undefined}>
          <span className="flex shrink-0 items-center gap-2">
            <span className="relative">
              {i === step && <span aria-hidden className="muster-ping absolute inset-0 rounded-full bg-coral/40" />}
              <span
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-[background-color,color,transform,box-shadow] duration-300 ease-muster",
                  i < step && "bg-mint text-white",
                  i === step && "muster-gradient-brand scale-110 text-white shadow-glow-coral",
                  i > step && "bg-canvas-deep text-ink-faint",
                )}
              >
                {i < step ? "✓" : i + 1}
              </span>
            </span>
            <span className={cn("hidden text-sm transition-colors duration-300 md:inline", i === step ? "font-semibold text-ink" : i < step ? "text-ink-soft" : "text-ink-faint")}>{title}</span>
          </span>
          {i < LAST_STEP && (
            <span aria-hidden className="mx-3 h-1 flex-1 overflow-hidden rounded-pill bg-line/70">
              <span className="block h-full rounded-pill bg-mint transition-[width] duration-500 ease-muster" style={{ width: i < step ? "100%" : "0%" }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export const Heading = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="mb-6 text-center">
    <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-ink">{title}</h1>
    {hint && <p className="mx-auto mt-2 max-w-xl text-[15px] leading-6 text-ink-soft">{hint}</p>}
  </div>
);

/* ───────── 1 欢迎 ───────── */

const FEATURES = [
  { icon: BotIcon, text: "一支 AI 团队，随时派活" },
  { icon: Cpu, text: "用你自己的模型与密钥" },
  { icon: Brain, text: "敏感操作先问你，再动手" },
] as const;

export function WelcomeStep({ name = "Pip" }: { name?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative grid place-items-center" style={{ width: 340, height: 280 }}>
        <span className="muster-halo absolute inset-0 rounded-full" style={{ ["--halo" as string]: "#ff8a65" }} />
        <span className="muster-halo absolute -right-4 top-0 size-44 rounded-full" style={{ ["--halo" as string]: "#8b7cf6" }} />
        <Pebble shape="round" color="cream" status="idle" size={200} title={name} mood="lively" halo className="relative" />
      </div>
      <Heading title={`你好，我是 ${name}`} hint="我是你的 AI 团队的主 Bot，只负责分发任务。接下来用几步把我们准备好，大概一分钟。" />
      <ul className="muster-stagger flex flex-wrap justify-center gap-3">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="muster-glass-2 flex items-center gap-2 rounded-pill px-4 py-2 text-sm text-ink-soft shadow-soft">
            <Icon className="size-4 text-coral" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── 2 名字与形象（实时预览） ───────── */

const PREVIEW_STATUSES: BotStatus[] = ["idle", "thinking", "working", "done"];

export function LookStep({ profile, onChange }: { profile: Profile; onChange: (patch: Partial<Profile>) => void }) {
  const [status, setStatus] = useState<BotStatus>("idle");
  return (
    <div className="mx-auto grid w-full max-w-4xl items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Card frosted className="relative flex flex-col items-center overflow-hidden px-6 py-8">
        <span aria-hidden className="muster-halo absolute inset-x-0 top-0 h-3/4" style={{ ["--halo" as string]: "#ff8a65" }} />
        <div className="relative" data-testid="look-preview">
          <Pebble shape={profile.shape} color={profile.color} status={status} size={168} mood="lively" halo />
        </div>
        <div className="relative mt-3 text-2xl font-semibold text-ink" data-testid="name-preview">{profile.name.trim() || "未命名"}</div>
        <div className="relative mt-1 text-sm text-ink-soft">主 Bot · 只做分发</div>
        <div className="relative mt-5">
          <Segmented value={status} onChange={setStatus} options={PREVIEW_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        </div>
        <div className="relative mt-2 text-xs text-ink-faint">试试看它在不同状态下的表情</div>
      </Card>

      <div>
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight text-ink">给你的主 Bot 起个名字</h1>
        <p className="mt-1.5 text-sm text-ink-soft">它会在主线里和你对话，随时可以再改。</p>

        <Field label="名字" htmlFor="ob-name" className="mt-5" hint={`${profile.name.length}/12`} error={profile.name.trim() === "" ? "名字不能为空" : undefined}>
          <Input
            id="ob-name"
            value={profile.name}
            onChange={(e) => onChange({ name: e.target.value })}
            maxLength={12}
            aria-label="主 Bot 名字"
            aria-invalid={profile.name.trim() === "" || undefined}
            placeholder="例如 Pip"
            autoFocus
          />
        </Field>

        <div className="mt-5 text-sm font-medium text-ink">形状</div>
        <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label="形状">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={profile.shape === s.value}
              aria-label={s.label}
              onClick={() => onChange({ shape: s.value })}
              className={cn(
                "flex cursor-pointer flex-col items-center rounded-2xl border px-3 py-2 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-muster hover:-translate-y-0.5 active:scale-95",
                profile.shape === s.value ? "border-coral bg-coral-soft shadow-glow-coral" : "border-line bg-surface hover:border-ink-faint/40 hover:shadow-soft",
              )}
            >
              <Pebble shape={s.value} color={profile.color} size={48} lite interactive={false} />
              <span className="mt-0.5 text-xs text-ink-soft">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 text-sm font-medium text-ink">颜色</div>
        <div className="mt-2.5 flex flex-wrap gap-3" role="radiogroup" aria-label="颜色">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={profile.color === c.value}
              aria-label={c.label}
              title={c.label}
              onClick={() => onChange({ color: c.value })}
              style={{ background: `var(--color-pebble-${c.value})` }}
              className={cn(
                "size-10 cursor-pointer rounded-full border-2 transition-[transform,border-color,box-shadow] duration-200 ease-muster hover:scale-110 active:scale-95",
                profile.color === c.value ? "scale-110 border-coral shadow-glow-coral" : "border-white shadow-card",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── 5 完成 ───────── */

export const EXAMPLES = ["交给小码修支付回调的 bug，交给阿克写退款接口", "每天早上 9 点给我一份晨间简报", "PR 打开时让阿克先看一遍"];

export function DoneStep({ profile, modelLabel, agentCount }: { profile: Profile; modelLabel?: string; agentCount?: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative grid place-items-center" style={{ width: 280, height: 220 }}>
        <span className="muster-halo absolute inset-0 rounded-full" style={{ ["--halo" as string]: "#34c58a" }} />
        <Pebble shape={profile.shape} color={profile.color} status="done" size={150} halo className="relative" />
      </div>
      <Heading title={`${profile.name.trim() || "Pip"} 准备好了`} hint="进入主线后，可以试着这样对我说：" />
      <div className="mb-5 flex flex-wrap justify-center gap-2">
        <Badge tone={modelLabel ? "mint" : "amber"} dot>{modelLabel ? `模型：${modelLabel}` : "模型：稍后在 设置 · 模型 中配置"}</Badge>
        <Badge tone={agentCount ? "mint" : "neutral"} dot>{agentCount ? `已检测到 ${agentCount} 个编程 Agent` : "未使用外部编程 Agent"}</Badge>
      </div>
      <ul className="muster-stagger grid w-full max-w-xl gap-3">
        {EXAMPLES.map((t) => (
          <li key={t} className="muster-glass-2 group flex items-center gap-3 rounded-card px-5 py-3.5 text-[15px] text-ink-soft shadow-soft transition-[transform,box-shadow] duration-200 ease-muster hover:-translate-y-0.5 hover:shadow-lift">
            <Wand2 className="size-4 shrink-0 text-lavender" />
            <span className="flex-1">“{t}”</span>
            <ArrowRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint"><Sparkles className="size-3.5" />这些设置之后都能在「设置」里修改</p>
    </div>
  );
}
