import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { BotColor, DetectedAgent, ModelRef, NativeToolGroup, PebbleShape } from "@muster/protocol";
import { Badge, Button, Field, Input, Pebble, Select, Skeleton, Textarea, cn, type SelectOption } from "@muster/ui";
import { AlertTriangle, Check, FilePen, FileText, Globe, RefreshCw, Shuffle, Terminal, X } from "lucide-react";
import { useHub } from "../../lib/hub";
import {
  COLORS, DEFAULT_MODEL_KEY, ENGINE_META, PERSONA_TEMPLATES, SHAPES, TOOL_GROUPS, modelHint, modelKey, parseModelKey, pick, sortTools,
  withStandardAgents, type PersonaTemplate,
} from "./meta";
import type { ModelOptionsState } from "./useModelOptions";

/** Draft shared by the add and configure drawers. */
export interface MemberDraft {
  type: "native" | "external";
  agent: DetectedAgent | null;
  name: string;
  tagline: string;
  shape: PebbleShape;
  color: BotColor;
  persona: string;
  modelKey: string;
  tools: NativeToolGroup[];
  skills: string[];
}

const NAME_MAX = 20;
const TAGLINE_MAX = 40;
export function nameError(name: string, taken: boolean): string | null {
  const n = name.trim();
  if (!n) return "给 TA 起个名字吧";
  if (n.length > NAME_MAX) return `名字不超过 ${NAME_MAX} 个字`;
  if (taken) return "团队里已经有同名成员了";
  return null;
}

const OPTION = "cursor-pointer rounded-control border bg-surface transition-colors duration-150";
const OPTION_ON = "border-accent bg-accent-surface";
const OPTION_OFF = "border-border hover:bg-surface-muted";

/* ───────── Look: name, specialty, shape, colour ───────── */

export function LookFields({ draft, onChange, nameErr, showErr, autoFocus, hideTagline }: { draft: MemberDraft; onChange: (p: Partial<MemberDraft>) => void; nameErr: string | null; showErr: boolean; autoFocus?: boolean; hideTagline?: boolean }) {
  const shuffle = () => onChange({ shape: pick(SHAPES.map((s) => s.value), draft.shape), color: pick(COLORS.map((c) => c.value), draft.color) });
  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-4">
        <Pebble shape={draft.shape} color={draft.color} status="idle" size={64} title="预览" />
        <div className="grid min-w-0 flex-1 gap-4">
          <Field label="名字" htmlFor="member-name" required error={showErr ? nameErr : null} hint={`最多 ${NAME_MAX} 个字`}>
            <Input
              id="member-name"
              autoFocus={autoFocus}
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="给 TA 起个名字"
              aria-invalid={showErr && nameErr ? true : undefined}
              maxLength={NAME_MAX + 10}
            />
          </Field>
          {!hideTagline && (
            <Field label="专长" htmlFor="member-tagline" hint="显示在名字下面，例如：代码与调试">
              <Input id="member-tagline" value={draft.tagline} onChange={(e) => onChange({ tagline: e.target.value })} placeholder="一句话说明 TA 擅长什么" maxLength={TAGLINE_MAX} />
            </Field>
          )}
        </div>
      </div>

      <fieldset>
        <div className="mb-2 flex items-center justify-between">
          <legend className="text-sm font-medium text-fg">形状</legend>
          <Button type="button" size="sm" variant="ghost" icon={<Shuffle size={14} />} onClick={shuffle}>随机一个</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-label={`形状 ${s.label}`}
              aria-pressed={s.value === draft.shape}
              onClick={() => onChange({ shape: s.value })}
              className={cn(OPTION, "grid size-12 place-items-center", s.value === draft.shape ? OPTION_ON : OPTION_OFF)}
            >
              <Pebble shape={s.value} color={draft.color} size={32} title={s.label} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">颜色</legend>
        <div className="flex flex-wrap gap-2.5">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={`颜色 ${c.label}`}
              aria-pressed={c.value === draft.color}
              onClick={() => onChange({ color: c.value })}
              style={{ background: `var(--color-pebble-${c.value})` }}
              className={cn(
                "grid size-8 cursor-pointer place-items-center rounded-full border border-border text-fg transition-shadow duration-150",
                c.value === draft.color && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
              )}
            >
              {c.value === draft.color && <Check size={14} />}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/* ───────── Type: native vs external agent (add drawer only) ───────── */

function TypeOption({ selected, onSelect, title, desc, badge }: { selected: boolean; onSelect: () => void; title: string; desc: string; badge?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(OPTION, "flex w-full items-start gap-3 p-3.5 text-left", selected ? OPTION_ON : OPTION_OFF)}
    >
      <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", selected ? "border-accent bg-accent text-white" : "border-border")}>
        {selected && <Check size={12} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-body font-medium text-fg">
          {title}
          {badge && <Badge tone="accent" size="sm">{badge}</Badge>}
        </span>
        <span className="mt-0.5 block text-sm text-fg-2">{desc}</span>
      </span>
    </button>
  );
}

export function TypeFields({
  draft, onChange, agents, agentsLoading, agentsError, onDetect,
}: {
  draft: MemberDraft;
  onChange: (p: Partial<MemberDraft>) => void;
  agents: DetectedAgent[] | null;
  agentsLoading: boolean;
  agentsError: string | null;
  onDetect: () => void;
}) {
  const list = useMemo(() => (agents ? withStandardAgents(agents) : null), [agents]);
  return (
    <div className="grid gap-3" role="radiogroup" aria-label="成员类型">
      <TypeOption
        selected={draft.type === "native"}
        onSelect={() => onChange({ type: "native", agent: null })}
        title="原生成员"
        badge="推荐"
        desc="用你配置的模型运行，可自定义人设、工具和技能。无需安装任何外部工具。"
      />
      <TypeOption
        selected={draft.type === "external"}
        onSelect={() => onChange({ type: "external" })}
        title="外部编程 Agent"
        desc="接入本机已安装的 Codex、Claude Code、OpenCode，适合在代码仓库里长时间干活。"
      />

      {draft.type === "external" && (
        <div className="rounded-control border border-border bg-surface-muted p-3" data-testid="agent-list">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-fg">本机检测到的 Agent</span>
            <Button type="button" size="sm" variant="ghost" icon={<RefreshCw size={14} className={agentsLoading ? "animate-spin" : undefined} />} onClick={onDetect} disabled={agentsLoading}>
              {agentsLoading ? "检测中…" : "重新检测"}
            </Button>
          </div>
          {agentsError && <p role="alert" className="mb-2 text-sm text-danger">{agentsError}</p>}
          {!list && agentsLoading && (
            <div className="grid gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {list && (
            <ul className="grid gap-2">
              {list.map((a) => {
                const meta = ENGINE_META[a.engine];
                const on = draft.agent?.engine === a.engine && draft.agent.command === a.command;
                return (
                  <li key={`${a.engine}-${a.command}`}>
                    <button
                      type="button"
                      disabled={!a.found}
                      aria-pressed={on}
                      aria-label={`${a.command} ${a.found ? "已检测到" : "未找到"}`}
                      onClick={() => onChange({ agent: a })}
                      className={cn(OPTION, "flex w-full items-start gap-3 px-3 py-2.5 text-left", a.found ? (on ? OPTION_ON : OPTION_OFF) : "cursor-not-allowed border-border opacity-70")}
                    >
                      <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white", a.found ? "bg-success" : "bg-fg-3")}>
                        {a.found ? <Check size={12} /> : <X size={12} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-fg">{a.command}</span>
                          <span className="text-xs text-fg-2">{a.found ? (a.version ?? meta.label) : "未安装"}</span>
                        </span>
                        {!a.found && <span className="mt-0.5 block text-xs text-fg-3">{meta.install}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── Abilities: persona / model / tools / skills ───────── */

const TOOL_ICON: Record<NativeToolGroup, typeof FileText> = { files: FileText, edit: FilePen, shell: Terminal, web: Globe };

function ToolPicker({ value, onChange }: { value: NativeToolGroup[]; onChange: (v: NativeToolGroup[]) => void }) {
  const toggle = (g: NativeToolGroup) => onChange(sortTools(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]));
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="工具">
      {TOOL_GROUPS.map((g) => {
        const on = value.includes(g.value);
        const Icon = TOOL_ICON[g.value];
        return (
          <button
            key={g.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(g.value)}
            className={cn(OPTION, "flex items-start gap-3 p-3 text-left", on ? OPTION_ON : OPTION_OFF)}
          >
            <Icon size={18} className={cn("mt-0.5 shrink-0", on ? "text-accent" : "text-fg-3")} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                {g.label}
                {g.approval && <Badge tone="warning" size="sm">需审批</Badge>}
              </span>
              <span className="block text-xs text-fg-3">{g.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SkillsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts.map((p) => p.slice(0, 20))])].slice(0, 12));
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      {value.map((s) => (
        <Badge key={s} className="gap-1 pr-1.5">
          {s}
          <button type="button" aria-label={`移除技能 ${s}`} onClick={() => onChange(value.filter((x) => x !== s))} className="grid size-4 cursor-pointer place-items-center rounded-md hover:bg-border">
            <X size={11} />
          </button>
        </Badge>
      ))}
      <input
        aria-label="添加技能"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(text)}
        placeholder={value.length ? "继续添加…" : "输入技能后回车，如：代码审查"}
        className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-3"
      />
    </div>
  );
}

function ModelPicker({
  value, onChange, options, main, onNavigate,
}: {
  value: string;
  onChange: (key: string) => void;
  options: ModelOptionsState;
  /** Pip: the model is the router model. */
  main?: boolean;
  onNavigate: () => void;
}) {
  const settings = useHub((s) => s.model.modelSettings);
  const goSettings = useNavigate();
  const { models, providers, loading, error } = options;
  const provName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

  const fallback = main ? settings.router : settings.native;
  const fallbackName = fallback ? (models.find((m) => m.provider === fallback.provider && m.id === fallback.modelId)?.name ?? fallback.modelId) : null;
  const defaultOpt: SelectOption = main
    ? { value: DEFAULT_MODEL_KEY, label: "跟随设置中的路由模型", description: fallbackName ? `当前：${fallbackName}` : "未配置时仅用规则路由" }
    : { value: DEFAULT_MODEL_KEY, label: "使用默认模型", description: fallbackName ? `当前：${fallbackName}` : "还没有设置默认模型" };

  const opts = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [defaultOpt, ...models.map((m) => ({ value: modelKey({ provider: m.provider, modelId: m.id }), label: m.name, description: modelHint(m) || undefined, group: provName(m.provider) }))];
    // The current value may no longer be listed (provider disabled): keep it so it is not silently lost.
    if (value !== DEFAULT_MODEL_KEY && !list.some((o) => o.value === value)) {
      const ref = parseModelKey(value) as ModelRef;
      list.push({ value, label: ref.modelId, description: "当前不可用", group: provName(ref.provider) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, providers, value, fallbackName, main]);

  return (
    <div className="grid gap-2">
      <Select id="member-model" value={value} onValueChange={onChange} options={opts} placeholder={loading ? "加载模型…" : "选择模型"} />
      {main && <p className="text-xs text-fg-3">Pip 用这个模型理解你的话并分发任务；不选则跟随「设置 · 模型」里的路由模型。</p>}
      {error && <p role="alert" className="text-xs text-danger">模型列表加载失败：{error}</p>}
      {!loading && !error && models.length === 0 && (
        <div role="status" className="flex items-start gap-2.5 rounded-control bg-warning-surface px-3 py-2.5 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">还没有可用的模型。先到设置里添加一个服务商并填入 API Key。</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => { onNavigate(); goSettings("/settings?tab=models"); }}>去设置</Button>
        </div>
      )}
    </div>
  );
}

function PersonaField({ value, onChange, onTemplate }: { value: string; onChange: (v: string) => void; onTemplate: (t: PersonaTemplate) => void }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="人设模板">
        <span className="text-xs text-fg-3">模板</span>
        {PERSONA_TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => onTemplate(t)} className={cn(OPTION, OPTION_OFF, "px-2.5 py-1 text-xs font-medium text-fg-2")}>
            {t.label}
          </button>
        ))}
      </div>
      <Textarea id="member-persona" value={value} onChange={(e) => onChange(e.target.value)} rows={6} maxLength={8000} placeholder="描述 TA 的角色、语气和做事原则。例如：你是一名严谨的研究员……" />
    </div>
  );
}

/** Abilities block. `kind` decides which parts show: Pip only has a router model, external agents only skills. */
export function PowerFields({
  kind, draft, onChange, onTemplate, options, onNavigate,
}: {
  kind: "native" | "main" | "external";
  draft: MemberDraft;
  onChange: (p: Partial<MemberDraft>) => void;
  onTemplate: (t: PersonaTemplate) => void;
  options: ModelOptionsState;
  onNavigate: () => void;
}) {
  return (
    <div className="grid gap-5">
      {kind === "native" && (
        <Field label="人设" htmlFor="member-persona" hint="告诉 TA 是谁、怎么做事。可选，但写了效果更好。">
          <PersonaField value={draft.persona} onChange={(persona) => onChange({ persona })} onTemplate={onTemplate} />
        </Field>
      )}
      {kind !== "external" && (
        <Field label={kind === "main" ? "路由模型" : "模型"} htmlFor="member-model">
          <ModelPicker value={draft.modelKey} onChange={(modelKey) => onChange({ modelKey })} options={options} main={kind === "main"} onNavigate={onNavigate} />
        </Field>
      )}
      {kind === "native" && (
        <Field label="可用工具" hint="修改文件和运行命令每次都会请你审批。">
          <ToolPicker value={draft.tools} onChange={(tools) => onChange({ tools })} />
        </Field>
      )}
      {kind !== "main" && (
        <Field label="技能标签" hint="用于在团队里展示 TA 擅长什么；最多 12 个。">
          <SkillsInput value={draft.skills} onChange={(skills) => onChange({ skills })} />
        </Field>
      )}
    </div>
  );
}
