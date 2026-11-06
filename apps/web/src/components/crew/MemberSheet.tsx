import { useEffect, useMemo, useState } from "react";
import type { Bot, DetectedAgent, Methods } from "@muster/protocol";
import { Badge, Button, Chip, Pebble, Sheet, SheetContent, cn, toast } from "@muster/ui";
import { ArrowLeft, ArrowRight, Check, Trash2 } from "lucide-react";
import { hubRequest, useHub } from "../../lib/hub";
import { LookFields, PowerFields, TypeStep, nameError, type MemberDraft } from "./MemberFields";
import {
  DEFAULT_MODEL_KEY, ENGINE_META, KIND_LABEL, KIND_TONE, TOOL_GROUPS, hasModel, isMainBot, modelKey, parseModelKey, pick, sameSet, sortTools,
  COLORS, SHAPES, type PersonaTemplate,
} from "./meta";
import { useModelOptions } from "./useModelOptions";

export type SheetTarget = { mode: "create" } | { mode: "edit"; bot: Bot };

export interface MemberSheetProps {
  /** null = 关闭。 */
  target: SheetTarget | null;
  onClose: () => void;
  onSaved: (bot: Bot, kind: "created" | "updated") => void;
  /** 编辑面板里点“删除成员”：页面负责关闭面板并弹出二次确认。 */
  onDelete: (bot: Bot) => void;
}

type StepId = "type" | "look" | "power" | "confirm";
const STEP_LABEL: Record<StepId, string> = { type: "类型", look: "外观", power: "能力", confirm: "确认" };
const STEP_DESC: Record<StepId, string> = {
  type: "第 1 步 · 选择成员类型",
  look: "第 2 步 · 起个名字，挑个模样",
  power: "第 3 步 · 设定人设、模型和工具",
  confirm: "最后确认一下",
};

export function MemberSheet(props: MemberSheetProps) {
  if (!props.target) return null;
  const key = props.target.mode === "edit" ? props.target.bot.id : "create";
  return <MemberSheetInner key={key} {...props} target={props.target} />;
}

function initialDraft(target: SheetTarget): MemberDraft {
  if (target.mode === "edit") {
    const b = target.bot;
    return {
      type: b.kind === "native" || b.kind === "main" ? "native" : "external",
      agent: null,
      name: b.name,
      shape: b.shape,
      color: b.color,
      persona: b.persona ?? "",
      modelKey: modelKey(b.model),
      tools: sortTools(b.tools ?? []),
      skills: b.skills,
    };
  }
  return { type: "native", agent: null, name: "", shape: pick(SHAPES.map((s) => s.value)), color: pick(COLORS.map((c) => c.value)), persona: "", modelKey: DEFAULT_MODEL_KEY, tools: ["files"], skills: [] };
}

/** 只包含真正改动过的字段；Pip 只允许 name / shape / color / model。 */
type BotPatch = Methods["bot.update"]["params"]["patch"];
export function buildPatch(bot: Bot, d: MemberDraft): BotPatch {
  const patch: BotPatch = {};
  if (d.name.trim() !== bot.name) patch.name = d.name.trim();
  if (d.shape !== bot.shape) patch.shape = d.shape;
  if (d.color !== bot.color) patch.color = d.color;
  if (hasModel(bot) && d.modelKey !== modelKey(bot.model)) {
    // 清空模型要发 null（JSON 会丢掉 undefined，daemon 把 null 当作“清除”）
    patch.model = parseModelKey(d.modelKey) ?? (null as unknown as undefined);
  }
  if (isMainBot(bot)) return patch;
  if (d.skills.join("|") !== bot.skills.join("|")) patch.skills = d.skills;
  if (bot.kind === "native") {
    if (d.persona.trim() !== (bot.persona ?? "")) patch.persona = d.persona.trim();
    if (!sameSet(d.tools, bot.tools ?? [])) patch.tools = d.tools;
  }
  return patch;
}

function MemberSheetInner({ target, onClose, onSaved, onDelete }: MemberSheetProps & { target: SheetTarget }) {
  const bots = useHub((s) => s.model.bots);
  const editing = target.mode === "edit" ? target.bot : null;
  const kind: "native" | "main" | "external" = editing ? (isMainBot(editing) ? "main" : editing.kind === "native" ? "native" : "external") : "native";

  const [draft, setDraft] = useState<MemberDraft>(() => initialDraft(target));
  const [stepIdx, setStepIdx] = useState(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<DetectedAgent[] | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const steps: StepId[] = draft.type === "native" ? ["type", "look", "power", "confirm"] : ["type", "look", "confirm"];
  const step = steps[Math.min(stepIdx, steps.length - 1)]!;
  const change = (p: Partial<MemberDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setError(null);
  };

  const modelNeeded = editing ? hasModel(editing) : draft.type === "native" && stepIdx >= 2;
  const modelOptions = useModelOptions(modelNeeded);

  async function detect() {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      setAgents((await hubRequest("bot.detectAgents", {})).agents);
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentsLoading(false);
    }
  }
  useEffect(() => {
    if (!editing && draft.type === "external" && agents === null && !agentsLoading && !agentsError) void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.type]);

  const taken = useMemo(() => Object.values(bots).some((b) => b.id !== editing?.id && b.name === draft.name.trim()), [bots, editing, draft.name]);
  const nameErr = nameError(draft.name, taken);

  const applyTemplate = (t: PersonaTemplate) => change({ persona: t.persona, tools: sortTools(t.tools), skills: t.skills });
  const modelLabel = (key: string) => {
    const ref = parseModelKey(key);
    if (!ref) return kind === "main" ? "跟随设置中的路由模型" : "默认模型";
    return modelOptions.models.find((m) => m.provider === ref.provider && m.id === ref.modelId)?.name ?? ref.modelId;
  };

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error({ title: editing ? "保存失败" : "创建失败", description: msg });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = draft.name.trim();
    const model = parseModelKey(draft.modelKey);
    const r = await run(() =>
      draft.type === "native"
        ? hubRequest("bot.add", {
            name, kind: "native", color: draft.color, shape: draft.shape, tools: draft.tools, skills: draft.skills,
            ...(draft.persona.trim() ? { persona: draft.persona.trim() } : {}),
            ...(model ? { model } : {}),
          })
        : (() => {
            const meta = ENGINE_META[draft.agent!.engine];
            return hubRequest("bot.add", { name, kind: meta.kind, engineLabel: meta.label, color: draft.color, shape: draft.shape });
          })(),
    );
    if (r) {
      toast.success({ title: `${r.bot.name} 加入了团队`, description: "可以去主线派活，或直接和 TA 聊天了" });
      onSaved(r.bot, "created");
    }
  }

  const patch = editing ? buildPatch(editing, draft) : {};
  const dirty = Object.keys(patch).length > 0;
  async function save() {
    if (!editing) return;
    if (nameErr) return setTouched(true);
    const r = await run(() => hubRequest("bot.update", { botId: editing.id, patch }));
    if (r) {
      toast.success(`已保存 ${r.bot.name} 的设置`);
      onSaved(r.bot, "updated");
    }
  }

  function next() {
    if (step === "look" && nameErr) return setTouched(true);
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  }
  const canNext = step === "type" ? draft.type === "native" || !!draft.agent : true;

  const goSettings = () => onClose();
  const lookNode = <LookFields draft={draft} onChange={change} nameErr={nameErr} showErr={touched} autoFocus={!editing} />;
  const powerNode = <PowerFields kind={kind} draft={draft} onChange={change} onTemplate={applyTemplate} options={modelOptions} onNavigate={goSettings} />;

  /* ───── 编辑 ───── */
  if (editing) {
    const deletable = !editing.builtin && !isMainBot(editing);
    return (
      <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
        <SheetContent
          width={560}
          title={`编辑 ${editing.name}`}
          description={kind === "main" ? "Pip 只允许修改名字、外观和路由模型" : kind === "external" ? `${editing.engineLabel} · 外部编程 Agent` : "原生成员 · 人设、模型和工具都可以改"}
          footer={
            <>
              {deletable && (
                <Button type="button" variant="ghost" className="mr-auto text-danger hover:bg-danger-soft hover:text-danger" icon={<Trash2 size={16} />} onClick={() => onDelete(editing)}>删除成员</Button>
              )}
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
              <Button type="button" variant="primary" loading={busy} disabled={!dirty || !!nameErr} onClick={() => void save()}>保存</Button>
            </>
          }
        >
          <div className="grid gap-8">
            <section aria-label="外观" className="grid gap-4">
              <h3 className="text-[15px] font-semibold text-ink">外观</h3>
              {lookNode}
            </section>
            <section aria-label="能力" className="grid gap-4">
              <h3 className="text-[15px] font-semibold text-ink">能力</h3>
              {powerNode}
            </section>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  /* ───── 新建向导 ───── */
  const last = step === "confirm";
  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent
        width={560}
        title="新建成员"
        description={STEP_DESC[step]}
        footer={
          <>
            {stepIdx > 0 ? (
              <Button type="button" variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStepIdx((i) => i - 1)} disabled={busy} className="mr-auto">上一步</Button>
            ) : (
              <Button type="button" variant="ghost" onClick={onClose} className="mr-auto">取消</Button>
            )}
            {last ? (
              <Button type="button" variant="primary" loading={busy} onClick={() => void create()}>创建成员</Button>
            ) : (
              <Button type="button" variant="primary" disabled={!canNext} onClick={next}>
                下一步<ArrowRight size={16} />
              </Button>
            )}
          </>
        }
      >
        <ol className="mb-6 flex items-center" aria-label="步骤">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === stepIdx ? "step" : undefined} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-[background-color,color,box-shadow] duration-300", i < stepIdx ? "bg-mint text-white" : i === stepIdx ? "muster-gradient-brand text-white shadow-glow-coral" : "bg-canvas-deep text-ink-faint")}>
                {i < stepIdx ? <Check size={14} /> : i + 1}
              </span>
              <span className={cn("ml-2 text-sm font-medium transition-colors", i === stepIdx ? "text-ink" : "text-ink-faint")}>{STEP_LABEL[s]}</span>
              {i < steps.length - 1 && <span className="mx-3 h-0.5 flex-1 overflow-hidden rounded-full bg-line"><span className={cn("block h-full bg-mint transition-[width] duration-500 ease-muster", i < stepIdx ? "w-full" : "w-0")} /></span>}
            </li>
          ))}
        </ol>

        <div key={step} className="muster-fade-in">
          {step === "type" && <TypeStep draft={draft} onChange={change} agents={agents} agentsLoading={agentsLoading} agentsError={agentsError} onDetect={() => void detect()} />}
          {step === "look" && lookNode}
          {step === "power" && powerNode}
          {step === "confirm" && (
            <div className="grid gap-4">
              <div className="flex items-center gap-4 rounded-card-lg p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--color-pebble-${draft.color}) 45%, white), white)` }}>
                <Pebble shape={draft.shape} color={draft.color} status="idle" size={88} halo title={draft.name.trim() || "预览"} />
                <div className="min-w-0">
                  <div className="truncate text-xl font-semibold text-ink">{draft.name.trim()}</div>
                  <Badge tone={draft.type === "native" ? KIND_TONE.native : KIND_TONE[ENGINE_META[draft.agent!.engine].kind]} className="mt-1.5">
                    {draft.type === "native" ? KIND_LABEL.native : ENGINE_META[draft.agent!.engine].label}
                  </Badge>
                </div>
              </div>
              <dl className="grid gap-3 text-sm">
                {draft.type === "native" ? (
                  <>
                    <Row label="模型">{modelLabel(draft.modelKey)}</Row>
                    <Row label="工具">
                      {draft.tools.length ? <span className="flex flex-wrap gap-1.5">{draft.tools.map((t) => <Chip key={t} tone={TOOL_GROUPS.find((g) => g.value === t)?.approval ? "amber" : "mint"}>{TOOL_GROUPS.find((g) => g.value === t)?.label}</Chip>)}</span> : <span className="text-ink-faint">不使用工具，只对话</span>}
                    </Row>
                    <Row label="技能">{draft.skills.length ? <span className="flex flex-wrap gap-1.5">{draft.skills.map((s) => <Chip key={s} tone="coral">{s}</Chip>)}</span> : <span className="text-ink-faint">未设置</span>}</Row>
                    <Row label="人设">{draft.persona.trim() ? <span className="line-clamp-4 whitespace-pre-wrap leading-relaxed text-ink-soft">{draft.persona.trim()}</span> : <span className="text-ink-faint">未设置</span>}</Row>
                  </>
                ) : (
                  <Row label="引擎">{draft.agent!.command}{draft.agent!.version ? ` ${draft.agent!.version}` : ""}</Row>
                )}
              </dl>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-baseline gap-3 border-b border-line pb-3 last:border-0">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
