// OWNER: C1. Handlers for: bot.add, bot.update, bot.remove (phase 2: persona / model / tools, edit and delete).
import type { Bot, BotColor, BotKind, ModelRef, NativeToolGroup, PebbleShape } from "@muster/protocol";
import type { DriverRegistry, Handlers, Hub } from "../core/contracts";
import { HandlerError } from "./errors";

const COLORS: BotColor[] = ["cream", "mint", "peach", "sky", "lilac", "rose", "butter"];
const SHAPES: PebbleShape[] = ["round", "square", "blob", "egg", "flat"];
const TOOL_GROUPS: NativeToolGroup[] = ["files", "edit", "shell", "web"];
const ENGINE_LABELS: Record<Exclude<BotKind, "main" | "native">, string> = { codex: "Codex", claude: "Claude", acp: "ACP" };
const NATIVE_LABEL_PREFIX = "原生 · ";

const MAX_NAME = 40;
const MAX_LABEL = 60;
const MAX_TAGLINE = 120;
const MAX_PERSONA = 8000;
const MAX_SKILLS = 30;
const MAX_SKILL = 40;

/** Fields a main bot (Pip) may change. `model` is the router model. */
const MAIN_EDITABLE: ReadonlySet<string> = new Set(["name", "shape", "color", "model"]);
const EDITABLE: ReadonlySet<string> = new Set(["name", "engineLabel", "tagline", "shape", "color", "skills", "persona", "model", "tools"]);
/** Tasks in these states keep a bot from being removed. */
const ACTIVE_TASK: ReadonlySet<string> = new Set(["running", "waiting_approval", "queued"]);

type Fields = Partial<Pick<Bot, "name" | "engineLabel" | "tagline" | "shape" | "color" | "skills" | "persona" | "model" | "tools">>;

export interface BotHandlersOptions {
  hub: Hub;
  drivers: DriverRegistry;
}

const nativeLabel = (model?: ModelRef): string => `${NATIVE_LABEL_PREFIX}${model?.modelId ?? "默认模型"}`;

function text(v: unknown, label: string, max: number): string {
  if (typeof v !== "string") throw new HandlerError("bad_request", `${label}必须是字符串`);
  const s = v.trim();
  if (s.length > max) throw new HandlerError("bad_request", `${label}不能超过 ${max} 个字`);
  return s;
}

/**
 * Validate the fields present in `raw` (absent / undefined-with-no-key fields are skipped).
 * Clearable fields (tagline, persona, model) are returned as `undefined` when emptied — the key stays present.
 */
function parseFields(raw: Record<string, unknown>): Fields {
  const out: Fields = {};
  if ("name" in raw) {
    const name = text(raw.name, "名称", MAX_NAME);
    if (!name) throw new HandlerError("bad_request", "名称不能为空");
    out.name = name;
  }
  if ("engineLabel" in raw && raw.engineLabel !== undefined) {
    const label = text(raw.engineLabel, "引擎标签", MAX_LABEL);
    if (label) out.engineLabel = label; // empty = not given (keeps / derives the default)
  }
  if ("tagline" in raw) out.tagline = raw.tagline == null ? undefined : text(raw.tagline, "简介", MAX_TAGLINE) || undefined;
  if ("persona" in raw) out.persona = raw.persona == null ? undefined : text(raw.persona, "人设", MAX_PERSONA) || undefined;
  if ("color" in raw && raw.color !== undefined) {
    if (!COLORS.includes(raw.color as BotColor)) throw new HandlerError("bad_request", `未知颜色：${String(raw.color)}`);
    out.color = raw.color as BotColor;
  }
  if ("shape" in raw && raw.shape !== undefined) {
    if (!SHAPES.includes(raw.shape as PebbleShape)) throw new HandlerError("bad_request", `未知形状：${String(raw.shape)}`);
    out.shape = raw.shape as PebbleShape;
  }
  if ("skills" in raw && raw.skills !== undefined) {
    if (!Array.isArray(raw.skills)) throw new HandlerError("bad_request", "技能必须是字符串数组");
    const skills = [...new Set(raw.skills.map((s) => text(s, "技能", MAX_SKILL)).filter(Boolean))];
    if (skills.length > MAX_SKILLS) throw new HandlerError("bad_request", `技能最多 ${MAX_SKILLS} 个`);
    out.skills = skills;
  }
  if ("tools" in raw && raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) throw new HandlerError("bad_request", "工具必须是数组");
    for (const t of raw.tools) if (!TOOL_GROUPS.includes(t as NativeToolGroup)) throw new HandlerError("bad_request", `未知工具组：${String(t)}`);
    out.tools = [...new Set(raw.tools as NativeToolGroup[])];
  }
  if ("model" in raw) {
    const m = raw.model as Partial<ModelRef> | null | undefined;
    if (m == null) out.model = undefined;
    else {
      if (typeof m !== "object" || typeof m.provider !== "string" || typeof m.modelId !== "string" || !m.provider.trim() || !m.modelId.trim()) {
        throw new HandlerError("bad_request", "模型必须包含 provider 与 modelId");
      }
      out.model = { provider: m.provider.trim(), modelId: m.modelId.trim() };
    }
  }
  return out;
}

export function createBotHandlers(o: BotHandlersOptions): Handlers {
  const { hub, drivers } = o;

  const assertNameFree = (name: string, exceptId?: string): void => {
    if (Object.values(hub.model.bots).some((b) => b.id !== exceptId && b.name === name)) throw new HandlerError("conflict", `已有同名 Bot：${name}`);
  };

  return {
    "bot.add": async (p) => {
      const raw = (p ?? {}) as Record<string, unknown>;
      if (typeof raw.name !== "string" || !raw.name.trim()) throw new HandlerError("bad_request", "名称不能为空");
      const kind = raw.kind as BotKind | undefined;
      if (!kind || kind === "main" || !drivers.has(kind)) throw new HandlerError("bad_request", `不支持的 Bot 类型：${String(kind)}`);
      const f = parseFields(raw);
      assertNameFree(f.name!);

      const n = Object.keys(hub.model.bots).length;
      const bot: Bot = {
        id: hub.newId("bot"),
        name: f.name!,
        kind,
        engineLabel: f.engineLabel ?? (kind === "native" ? nativeLabel(f.model) : ENGINE_LABELS[kind]),
        shape: f.shape ?? SHAPES[n % SHAPES.length]!,
        color: f.color ?? COLORS[n % COLORS.length]!,
        status: "idle",
        skills: f.skills ?? [],
        costWeekUsd: 0,
        threadId: "",
        ...(f.tagline ? { tagline: f.tagline } : {}),
        ...(f.persona ? { persona: f.persona } : {}),
        ...(f.model ? { model: f.model } : {}),
        ...(f.tools ? { tools: f.tools } : kind === "native" ? { tools: ["files"] as NativeToolGroup[] } : {}),
      };
      hub.commit({ kind: "bot.added", bot });
      return { bot };
    },

    "bot.update": async (p) => {
      const bot = typeof p?.botId === "string" ? hub.model.bots[p.botId] : undefined;
      if (!bot) throw new HandlerError("not_found", `Bot 不存在：${String(p?.botId)}`);
      const patch = p.patch as Record<string, unknown> | undefined;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HandlerError("bad_request", "缺少 patch");
      const allowed = bot.kind === "main" ? MAIN_EDITABLE : EDITABLE;
      for (const k of Object.keys(patch)) {
        if (!allowed.has(k)) throw new HandlerError("bad_request", bot.kind === "main" && EDITABLE.has(k) ? `主 Bot 不能修改：${k}` : `不可修改的字段：${k}`);
      }
      const f = parseFields(patch);
      if (f.name !== undefined) assertNameFree(f.name, bot.id);

      const next: Bot = { ...bot, ...f };
      for (const k of ["tagline", "persona", "model"] as const) if (next[k] === undefined) delete next[k];
      // Auto-generated native label follows the model; a label the user set (or a seed label) stays.
      if ("model" in f && f.engineLabel === undefined && bot.kind === "native" && bot.engineLabel.startsWith(NATIVE_LABEL_PREFIX)) {
        next.engineLabel = nativeLabel(next.model);
      }
      if (JSON.stringify(next) === JSON.stringify(bot)) return { bot };
      hub.commit({ kind: "bot.updated", bot: next });
      return { bot: hub.model.bots[bot.id] ?? next };
    },

    "bot.remove": async (p) => {
      const bot = typeof p?.botId === "string" ? hub.model.bots[p.botId] : undefined;
      if (!bot) throw new HandlerError("not_found", `Bot 不存在：${String(p?.botId)}`);
      if (bot.kind === "main") throw new HandlerError("bad_request", "主 Bot 不能删除");
      if (bot.builtin) throw new HandlerError("bad_request", `${bot.name} 是内置成员，不能删除（可以编辑）`);
      if (Object.values(hub.model.tasks).some((t) => t.botId === bot.id && ACTIVE_TASK.has(t.status))) {
        throw new HandlerError("conflict", `${bot.name} 还有进行中的任务，请先取消或等它完成`);
      }
      hub.commit({ kind: "bot.removed", botId: bot.id });
      return { ok: true };
    },
  };
}
