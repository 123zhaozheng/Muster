import { Check } from "lucide-react";
import type { BotColor, PebbleShape } from "@muster/protocol";
import { Badge, Field, Input, Pebble, cn } from "@muster/ui";

const STEP_TITLES = ["形象", "模型", "Agent", "完成"] as const;
export const LAST_STEP = STEP_TITLES.length - 1;

export const ONBOARDED_KEY = "muster.onboarded";
/** 主 Bot 的名字与形象。完成时同时写入本机（兜底）并通过 bot.update 同步给 daemon。 */
export const PROFILE_KEY = "muster.mainBotProfile";

const SHAPES: { value: PebbleShape; label: string }[] = [
  { value: "round", label: "圆圆" },
  { value: "square", label: "方方" },
  { value: "blob", label: "软软" },
  { value: "egg", label: "蛋蛋" },
  { value: "flat", label: "扁扁" },
];
/** 成员色只有这五种；协议里旧的 rose / butter 会显示成 peach / cream。 */
const COLORS: { value: BotColor; label: string }[] = [
  { value: "cream", label: "奶油" },
  { value: "mint", label: "薄荷" },
  { value: "peach", label: "蜜桃" },
  { value: "sky", label: "天空" },
  { value: "lilac", label: "丁香" },
];

export interface Profile {
  name: string;
  shape: PebbleShape;
  color: BotColor;
}

/** 把旧颜色折算到五种成员色之一。 */
export function normalizeColor(color: BotColor): BotColor {
  if (color === "rose") return "peach";
  if (color === "butter") return "cream";
  return color;
}

/** 步骤指示：圆点 + 名称，已完成的打勾。 */
export function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex items-center justify-center gap-2" aria-label="步骤">
      {STEP_TITLES.map((title, i) => (
        <li key={title} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full text-xs font-medium",
              i < step && "bg-success-surface text-success",
              i === step && "bg-accent text-white",
              i > step && "bg-surface-muted text-fg-3",
            )}
          >
            {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn("text-sm", i === step ? "font-medium text-fg" : "text-fg-3")}>{title}</span>
          {i < LAST_STEP && <span aria-hidden className="mx-1 h-px w-6 bg-border sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}

export const Heading = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="mb-6 text-center">
    <h1 className="text-title font-semibold tracking-tight text-fg">{title}</h1>
    {hint && <p className="mx-auto mt-2 max-w-md text-body leading-relaxed text-fg-2">{hint}</p>}
  </div>
);

/* ───────── 1 名字与形象 ───────── */

export function LookStep({ profile, onChange }: { profile: Profile; onChange: (patch: Partial<Profile>) => void }) {
  const empty = profile.name.trim() === "";
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-6 flex flex-col items-center text-center">
        <div data-testid="look-preview">
          <Pebble shape={profile.shape} color={profile.color} status="idle" size={72} />
        </div>
        <h1 className="mt-4 text-title font-semibold tracking-tight text-fg">你好，我是 <span data-testid="name-preview">{profile.name.trim() || "未命名"}</span></h1>
        <p className="mt-2 text-body leading-relaxed text-fg-2">我负责理解你的话，把活分给合适的成员。先给我起个名字、选个样子，之后随时可以改。</p>
      </div>

      <Field label="名字" htmlFor="ob-name" hint={`${profile.name.length}/12`} error={empty ? "名字不能为空" : undefined}>
        <Input
          id="ob-name"
          value={profile.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={12}
          aria-label="主 Bot 名字"
          aria-invalid={empty || undefined}
          placeholder="例如 Pip"
          autoFocus
        />
      </Field>

      <div className="mt-5 text-sm font-medium text-fg">形状</div>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="形状">
        {SHAPES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={profile.shape === s.value}
            aria-label={s.label}
            onClick={() => onChange({ shape: s.value })}
            className={cn(
              "flex cursor-pointer flex-col items-center rounded-card border px-3 py-2 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent",
              profile.shape === s.value ? "border-accent bg-accent-surface" : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            <Pebble shape={s.value} color={profile.color} size={40} />
            <span className="mt-1 text-xs text-fg-2">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 text-sm font-medium text-fg">颜色</div>
      <div className="mt-2 flex flex-wrap gap-3" role="radiogroup" aria-label="颜色">
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
              "size-9 cursor-pointer rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
              profile.color === c.value && "ring-2 ring-accent ring-offset-2",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────── 4 完成 ───────── */

const EXAMPLES = ["帮我梳理这周要做的事", "看看这个项目最近改了什么", "给我写一份会议纪要的模板"];

export function DoneStep({ profile, modelLabel, agentCount }: { profile: Profile; modelLabel?: string; agentCount?: number }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center">
      <Pebble shape={profile.shape} color={profile.color} status="done" size={72} />
      <h1 className="mt-4 text-title font-semibold tracking-tight text-fg">{profile.name.trim() || "Pip"} 准备好了</h1>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Badge tone={modelLabel ? "success" : "warning"} dot>{modelLabel ? `模型：${modelLabel}` : "模型：稍后在 设置 · 模型与连接 中配置"}</Badge>
        <Badge tone={agentCount ? "success" : "neutral"} dot>{agentCount ? `已检测到 ${agentCount} 个编程 Agent` : "未使用外部编程 Agent"}</Badge>
      </div>
      <p className="mt-6 text-body text-fg-2">进入主线后，可以试着这样对我说：</p>
      <ul className="mt-3 grid w-full gap-2">
        {EXAMPLES.map((t) => (
          <li key={t} className="rounded-card border border-border bg-surface px-4 py-3 text-body text-fg-2">“{t}”</li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-fg-3">这些设置之后都能在「设置」里修改。</p>
    </div>
  );
}
