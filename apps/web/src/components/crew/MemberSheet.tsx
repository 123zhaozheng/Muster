import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bot, DetectedAgent, Methods } from "@muster/protocol";
import { Button, Drawer, DrawerContent, toast } from "@muster/ui";
import { Trash2 } from "lucide-react";
import { hubRequest, useHub } from "../../lib/hub";
import { LookFields, PowerFields, TypeFields, nameError, type MemberDraft } from "./MemberFields";
import { COLORS, DEFAULT_MODEL_KEY, ENGINE_META, SHAPES, hasModel, isMainBot, modelKey, parseModelKey, pick, sameSet, sortTools, type PersonaTemplate } from "./meta";
import { useModelOptions } from "./useModelOptions";

export type SheetTarget = { mode: "create" } | { mode: "edit"; bot: Bot };

export interface MemberSheetProps {
  /** null = closed. */
  target: SheetTarget | null;
  onClose: () => void;
  onSaved: () => void;
  /** "Delete member" in the configure drawer: the page closes the drawer and asks for confirmation. */
  onDelete: (bot: Bot) => void;
}

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
      tagline: b.tagline ?? "",
      shape: b.shape,
      color: b.color,
      persona: b.persona ?? "",
      modelKey: modelKey(b.model),
      tools: sortTools(b.tools ?? []),
      skills: b.skills,
    };
  }
  return { type: "native", agent: null, name: "", tagline: "", shape: pick(SHAPES.map((s) => s.value)), color: pick(COLORS.map((c) => c.value)), persona: "", modelKey: DEFAULT_MODEL_KEY, tools: ["files"], skills: [] };
}

/** Only the fields that actually changed; Pip may only change name / shape / color / model. */
type BotPatch = Methods["bot.update"]["params"]["patch"];
function buildPatch(bot: Bot, d: MemberDraft): BotPatch {
  const patch: BotPatch = {};
  if (d.name.trim() !== bot.name) patch.name = d.name.trim();
  if (d.shape !== bot.shape) patch.shape = d.shape;
  if (d.color !== bot.color) patch.color = d.color;
  if (hasModel(bot) && d.modelKey !== modelKey(bot.model)) {
    // Clearing the model sends null (JSON drops undefined; the daemon treats null as "clear").
    patch.model = parseModelKey(d.modelKey) ?? (null as unknown as undefined);
  }
  if (isMainBot(bot)) return patch;
  if (d.tagline.trim() !== (bot.tagline ?? "")) patch.tagline = d.tagline.trim();
  if (d.skills.join("|") !== bot.skills.join("|")) patch.skills = d.skills;
  if (bot.kind === "native") {
    if (d.persona.trim() !== (bot.persona ?? "")) patch.persona = d.persona.trim();
    if (!sameSet(d.tools, bot.tools ?? [])) patch.tools = d.tools;
  }
  return patch;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4">
      <h3 className="text-body font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function MemberSheetInner({ target, onClose, onSaved, onDelete }: MemberSheetProps & { target: SheetTarget }) {
  const bots = useHub((s) => s.model.bots);
  const editing = target.mode === "edit" ? target.bot : null;
  const kind: "native" | "main" | "external" = editing ? (isMainBot(editing) ? "main" : editing.kind === "native" ? "native" : "external") : "native";

  const [draft, setDraft] = useState<MemberDraft>(() => initialDraft(target));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<DetectedAgent[] | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const change = (p: Partial<MemberDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setError(null);
  };

  const modelOptions = useModelOptions(editing ? hasModel(editing) : draft.type === "native");

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

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error({ title: editing ? "保存失败" : "添加失败", description: msg });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (nameErr) return setTouched(true);
    const name = draft.name.trim();
    const tagline = draft.tagline.trim();
    const common = { name, color: draft.color, shape: draft.shape, skills: draft.skills, ...(tagline ? { tagline } : {}) };
    const model = parseModelKey(draft.modelKey);
    const r = await run(() => {
      if (draft.type === "native") {
        return hubRequest("bot.add", {
          ...common, kind: "native", tools: draft.tools,
          ...(draft.persona.trim() ? { persona: draft.persona.trim() } : {}),
          ...(model ? { model } : {}),
        });
      }
      const meta = ENGINE_META[draft.agent!.engine];
      return hubRequest("bot.add", { ...common, kind: meta.kind, engineLabel: meta.label });
    });
    if (r) {
      toast.success({ title: `${r.bot.name} 加入了团队`, description: "可以去主线派活，或直接和 TA 聊天了" });
      onSaved();
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
      onSaved();
    }
  }

  const look = <LookFields draft={draft} onChange={change} nameErr={nameErr} showErr={touched} autoFocus={!editing} hideTagline={kind === "main"} />;
  const power = <PowerFields kind={kind} draft={draft} onChange={change} onTemplate={applyTemplate} options={modelOptions} onNavigate={onClose} />;
  const errorNode = error && <p role="alert" className="text-sm text-danger">{error}</p>;

  if (editing) {
    const deletable = !editing.builtin && !isMainBot(editing);
    return (
      <Drawer open onOpenChange={(o) => !o && !busy && onClose()}>
        <DrawerContent
          width={520}
          title={`配置 ${editing.name}`}
          description={kind === "main" ? "Pip 只允许修改名字、外观和路由模型" : kind === "external" ? `${editing.engineLabel} · 外部编程 Agent` : "原生成员 · 人设、模型和工具都可以改"}
          footer={
            <>
              {deletable && (
                <Button type="button" variant="ghost" className="mr-auto text-danger hover:bg-danger-surface" icon={<Trash2 size={16} />} onClick={() => onDelete(editing)}>删除成员</Button>
              )}
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
              <Button type="button" variant="primary" loading={busy} disabled={!dirty || !!nameErr} onClick={() => void save()}>保存</Button>
            </>
          }
        >
          <div className="grid gap-8">
            <Group title="外观">{look}</Group>
            <Group title="能力">{power}</Group>
            {errorNode}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  const ready = draft.type === "native" || !!draft.agent;
  return (
    <Drawer open onOpenChange={(o) => !o && !busy && onClose()}>
      <DrawerContent
        width={520}
        title="添加成员"
        description="选择成员类型，起个名字，设定 TA 能做什么"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
            <Button type="button" variant="primary" loading={busy} disabled={!ready} onClick={() => void create()}>添加成员</Button>
          </>
        }
      >
        <div className="grid gap-8">
          <Group title="类型">
            <TypeFields draft={draft} onChange={change} agents={agents} agentsLoading={agentsLoading} agentsError={agentsError} onDetect={() => void detect()} />
          </Group>
          <Group title="外观">{look}</Group>
          <Group title="能力">{power}</Group>
          {errorNode}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
