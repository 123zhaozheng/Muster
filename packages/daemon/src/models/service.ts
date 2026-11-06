// OWNER: M1 (phase 2). Model configuration service on top of pi-ai — see ModelService in core/contracts.ts.
//
// - 用户配置：dataDir/models.json（providers + settings）；密钥：dataDir/credentials.json（pi-ai CredentialStore，永不外发）。
// - 每次变更重建 pi-ai Models、通知 onChange、hub.commit(models.changed)。
// - 环境变量兜底：仅当用户一个 provider 都没配时，MUSTER_NATIVE_* / MUSTER_ROUTER_* 旧变量和 pi-ai 内置 provider 的
//   env key 作为“隐式 provider”（id 形如 env-native / env-router，或内置 id 本身；name 带“环境变量”）参与解析；
//   用户一旦添加了任何 provider，隐式 provider 全部让位。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider, isModelType, type AnyModel, type AuthContext, type Model, type Models, type Provider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Iso, ModelInfo, ModelProviderConfig, ModelRef, ModelSettings, ProviderCatalogEntry, ProviderKind } from "@muster/protocol";
import type { Handlers, Hub, ModelRefLike, ModelService, ModelSettingsLike } from "../core/contracts";
import { HandlerError } from "../handlers/errors";
import { ENV_VARS, envKeyOf, groupOf, sortCatalog } from "./catalog";
import { createFileCredentialStore, readJsonSync, writeJsonAtomic } from "./credentials";
import { friendlyError, redact } from "./errors";

/** 落盘的 provider 配置 = ModelProviderConfig 去掉 hasApiKey（密钥另存）。 */
type StoredProvider = Omit<ModelProviderConfig, "hasApiKey">;

interface StoredConfig {
  version: 1;
  providers: StoredProvider[];
  settings: ModelSettings;
}

/** 参与解析的 provider：用户配置的，或由环境变量隐式生成的（key 只在内存中）。 */
interface EffectiveProvider {
  cfg: StoredProvider;
  implicit?: { key?: string; origin: string };
}

const KINDS: readonly ProviderKind[] = ["builtin", "openai-compatible", "anthropic-compatible"];
const CUSTOM_ID = /^custom-[a-z0-9][a-z0-9-]{0,40}$/;
const TEST_TIMEOUT_MS = 30_000;
const REFRESH_TIMEOUT_MS = 8_000;

export function createModelService(o: { hub: Hub; dataDir: string; env?: NodeJS.ProcessEnv }): ModelService {
  const { hub } = o;
  const env = o.env ?? process.env;
  const configFile = join(o.dataDir, "models.json");
  const creds = createFileCredentialStore(join(o.dataDir, "credentials.json"));
  const startedAt: Iso = hub.now();
  const listeners = new Set<() => void>();

  const authContext: AuthContext = {
    env: async (name) => env[name],
    fileExists: async (p) => existsSync(p.startsWith("~") ? join(homedir(), p.slice(1)) : p),
  };

  // 内置 provider 实例只构造一次（含动态 provider 的缓存状态）。
  const builtinById = new Map(builtinProviders().map((p) => [p.id, p]));
  const isCatalogVisible = (p: Provider) => !!p.auth.apiKey && p.getModels().length > 0;

  // 串行化所有变更，避免并发写文件 / 交错重建。
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  // ───────────── 配置装载 / 持久化 ─────────────

  function loadConfig(): StoredConfig {
    const raw = readJsonSync(configFile) as Partial<StoredConfig> | undefined;
    const seen = new Set<string>();
    const providers: StoredProvider[] = [];
    for (const p of Array.isArray(raw?.providers) ? raw.providers : []) {
      if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !KINDS.includes(p.kind) || seen.has(p.id)) continue;
      seen.add(p.id);
      providers.push({
        id: p.id, kind: p.kind, builtinId: p.builtinId, name: p.name, baseUrl: p.baseUrl,
        enabled: p.enabled !== false, modelIds: Array.isArray(p.modelIds) ? p.modelIds.filter((m) => typeof m === "string") : undefined,
        createdAt: typeof p.createdAt === "string" ? p.createdAt : startedAt,
      });
    }
    const ref = (r: unknown): ModelRef | undefined => (isRef(r) ? { provider: r.provider, modelId: r.modelId } : undefined);
    return { version: 1, providers, settings: compact({ router: ref(raw?.settings?.router), native: ref(raw?.settings?.native) }) };
  }

  let stored = loadConfig();
  const persistConfig = () => writeJsonAtomic(configFile, stored);

  // ───────────── 有效 provider / 设置（含环境变量兜底） ─────────────

  function implicitProviders(): { providers: EffectiveProvider[]; settings: ModelSettings } {
    if (stored.providers.length > 0) return { providers: [], settings: {} };
    const providers: EffectiveProvider[] = [];
    const settings: ModelSettings = {};
    const mk = (id: string, name: string, baseUrl: string, modelId: string, key: string | undefined, origin: string): EffectiveProvider => ({
      cfg: { id, kind: "openai-compatible", name, baseUrl, enabled: true, modelIds: [modelId], createdAt: startedAt },
      implicit: { key, origin },
    });

    const nModel = env.MUSTER_NATIVE_MODEL?.trim();
    const nBase = env.MUSTER_NATIVE_BASE_URL?.trim();
    if (nModel && nBase) {
      providers.push(mk("env-native", "环境变量 · MUSTER_NATIVE", nBase, nModel, env.MUSTER_NATIVE_API_KEY?.trim() || undefined, "MUSTER_NATIVE_*"));
      settings.native = { provider: "env-native", modelId: nModel };
    }

    const flag = (env.MUSTER_ROUTER_LLM ?? "").trim().toLowerCase();
    const rBase = env.MUSTER_ROUTER_BASE_URL?.trim();
    const rKey = env.MUSTER_ROUTER_API_KEY?.trim();
    const rModel = env.MUSTER_ROUTER_MODEL?.trim();
    if (flag && !["0", "false", "off", "no"].includes(flag) && rBase && rKey && rModel) {
      providers.push(mk("env-router", "环境变量 · MUSTER_ROUTER", rBase, rModel, rKey, "MUSTER_ROUTER_*"));
      settings.router = { provider: "env-router", modelId: rModel };
    }

    for (const p of builtinById.values()) {
      if (!isCatalogVisible(p) || !envKeyOf(p.id, env)) continue;
      providers.push({
        cfg: { id: p.id, kind: "builtin", builtinId: p.id, name: `${p.name}（环境变量）`, enabled: true, createdAt: startedAt },
        implicit: { origin: ENV_VARS[p.id]?.[0] ?? "env" },
      });
    }
    // 旧用法：MUSTER_NATIVE_MODEL + OPENAI_API_KEY（无 BASE_URL）→ pi-ai 内置 OpenAI。
    if (nModel && !nBase && providers.some((e) => e.cfg.id === "openai")) settings.native = { provider: "openai", modelId: nModel };
    return { providers, settings };
  }

  const effective = (): EffectiveProvider[] => [...stored.providers.map((cfg) => ({ cfg })), ...implicitProviders().providers];

  function effectiveSettings(): ModelSettings {
    const imp = implicitProviders().settings;
    return compact({ router: stored.settings.router ?? imp.router, native: stored.settings.native ?? imp.native });
  }

  const find = (id: string) => effective().find((e) => e.cfg.id === id);

  // ───────────── 构建 pi-ai Models ─────────────

  function buildModels(): Models {
    const models = createModels({ credentials: creds, authContext });
    for (const e of effective()) {
      if (!e.cfg.enabled) continue;
      const p = e.cfg.kind === "builtin" ? tuneBuiltin(e.cfg) : customProvider(e);
      if (p) models.setProvider(p);
    }
    return models;
  }

  /** 内置 provider：按 modelIds 白名单过滤、按 baseUrl 覆盖端点（代理 / 中转）。 */
  function tuneBuiltin(cfg: StoredProvider): Provider | undefined {
    const base = builtinById.get(cfg.builtinId ?? cfg.id);
    if (!base) return undefined;
    const allow = cfg.modelIds?.length ? new Set(cfg.modelIds) : undefined;
    const baseUrl = cfg.baseUrl;
    if (!allow && !baseUrl) return base;
    const tune = <T extends AnyModel>(list: readonly T[]): T[] =>
      list.filter((m) => !allow || !isModelType(m, "chat") || allow.has(m.id)).map((m) => (baseUrl ? { ...m, baseUrl } : m));
    const getAll = base.getAllModels?.bind(base);
    return {
      ...base,
      baseUrl: baseUrl ?? base.baseUrl,
      getModels: () => tune(base.getModels()),
      getAllModels: getAll ? () => tune(getAll()) : undefined,
    };
  }

  /** OpenAI / Anthropic 兼容端点。key 取自 CredentialStore（隐式 provider 取环境变量）；无 key 时给占位符（SDK 要求非空）。 */
  function customProvider(e: EffectiveProvider): Provider {
    const { cfg } = e;
    const baseUrl = cfg.baseUrl ?? "";
    const common = { id: cfg.id, name: cfg.name, baseUrl };
    const auth = {
      apiKey: {
        name: cfg.name,
        resolve: async ({ credential }: { credential?: { key?: string } }) => {
          const own = credential?.key?.trim();
          const key = own || e.implicit?.key;
          return { auth: { apiKey: key || "no-key-required" }, source: own ? "stored credential" : key ? (e.implicit?.origin ?? "environment") : "no key" };
        },
      },
    };
    const base = { provider: cfg.id, baseUrl, reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_192 };
    const ids = cfg.modelIds ?? [];
    if (cfg.kind === "anthropic-compatible") {
      const models: Model<"anthropic-messages">[] = ids.map((id) => ({
        ...base, id, name: id, api: "anthropic-messages", compat: { supportsLongCacheRetention: false, supportsEagerToolInputStreaming: false },
      }));
      return createProvider({ ...common, auth, models, api: anthropicMessagesApi() });
    }
    // 对未知端点取保守值：不发 store / developer role / reasoning_effort，用 max_tokens。
    const models: Model<"openai-completions">[] = ids.map((id) => ({
      ...base, id, name: id, api: "openai-completions",
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
    }));
    return createProvider({ ...common, auth, models, api: openAICompletionsApi() });
  }

  let current: Models = buildModels();

  // ───────────── 变更流程 ─────────────

  /** 在互斥区内修改 stored，落盘、重建、通知、推送；落盘失败则回滚。 */
  function mutate<T>(fn: () => Promise<T> | T): Promise<T> {
    return exclusive(async () => {
      const before = stored;
      stored = { ...stored, providers: [...stored.providers], settings: { ...stored.settings } };
      try {
        const result = await fn();
        await persistConfig();
        afterChange();
        return result;
      } catch (e) {
        stored = before;
        throw e;
      }
    });
  }

  function afterChange(): void {
    current = buildModels();
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (e) {
        console.error("[models] onChange listener failed", e instanceof Error ? e.message : "error");
      }
    }
    hub.commit({ kind: "models.changed", settings: effectiveSettings() });
  }

  function toConfig(e: EffectiveProvider): ModelProviderConfig {
    const { cfg } = e;
    const builtinUrl = cfg.kind === "builtin" ? builtinById.get(cfg.builtinId ?? cfg.id)?.baseUrl : undefined;
    const baseUrl = cfg.baseUrl ?? builtinUrl;
    return {
      id: cfg.id,
      kind: cfg.kind,
      ...(cfg.builtinId ? { builtinId: cfg.builtinId } : {}),
      name: cfg.name,
      ...(baseUrl ? { baseUrl } : {}),
      hasApiKey: e.implicit ? !!e.implicit.key || cfg.kind === "builtin" : creds.hasApiKey(cfg.id),
      enabled: cfg.enabled,
      ...(cfg.modelIds ? { modelIds: [...cfg.modelIds] } : {}),
      createdAt: cfg.createdAt,
    };
  }

  // ───────────── RPC handlers ─────────────

  const handlers: Handlers = {
    "model.catalog": async () => {
      const entries: ProviderCatalogEntry[] = [];
      for (const p of builtinById.values()) {
        if (!isCatalogVisible(p)) continue;
        entries.push({
          id: p.id,
          name: p.name,
          ...(ENV_VARS[p.id] ? { envVar: ENV_VARS[p.id]![0] } : {}),
          ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
          modelCount: p.getModels().length,
          envConfigured: !!envKeyOf(p.id, env),
          group: groupOf(p.id),
        });
      }
      return { providers: sortCatalog(entries) };
    },

    "model.providers": async () => ({ providers: effective().map(toConfig), settings: effectiveSettings() }),

    "model.providerUpsert": ({ provider: input, apiKey }) =>
      mutate(async () => {
        if (!input || typeof input !== "object") throw new HandlerError("bad_request", "缺少 provider");
        if (!KINDS.includes(input.kind)) throw new HandlerError("bad_request", `未知的 provider 类型：${String(input.kind)}`);
        if (input.id?.startsWith("env-")) throw new HandlerError("bad_request", "环境变量提供的配置不能编辑；请新增自己的 provider");
        const key = normalizeKey(apiKey);

        let cfg: StoredProvider;
        if (input.kind === "builtin") {
          const builtinId = input.builtinId ?? input.id;
          const base = builtinId ? builtinById.get(builtinId) : undefined;
          if (!builtinId || !base || !isCatalogVisible(base)) throw new HandlerError("bad_request", `内置服务商目录中没有 "${String(builtinId)}"`);
          if (input.id && input.id !== builtinId) throw new HandlerError("bad_request", "内置服务商的 id 必须等于 builtinId");
          const url = cleanUrl(input.baseUrl, false);
          const prev = stored.providers.find((p) => p.id === builtinId);
          cfg = {
            id: builtinId, kind: "builtin", builtinId,
            name: input.name?.trim() || base.name,
            baseUrl: url && url !== base.baseUrl ? url : undefined,
            enabled: input.enabled !== false,
            modelIds: uniqueIds(input.modelIds),
            createdAt: prev?.createdAt ?? hub.now(),
          };
        } else {
          const id = input.id ?? hub.newId("custom");
          if (!CUSTOM_ID.test(id)) throw new HandlerError("bad_request", "自定义 provider 的 id 必须形如 custom-xxxx（小写字母、数字、连字符）");
          const baseUrl = cleanUrl(input.baseUrl, true);
          const modelIds = uniqueIds(input.modelIds);
          if (!input.name?.trim()) throw new HandlerError("bad_request", "请填写名称");
          if (!modelIds?.length) throw new HandlerError("bad_request", "请至少填写一个模型 ID");
          const prev = stored.providers.find((p) => p.id === id);
          cfg = { id, kind: input.kind, name: input.name.trim(), baseUrl, enabled: input.enabled !== false, modelIds, createdAt: prev?.createdAt ?? hub.now() };
        }
        const idx = stored.providers.findIndex((p) => p.id === cfg.id);
        if (idx >= 0 && stored.providers[idx]!.kind !== cfg.kind) throw new HandlerError("conflict", `provider ${cfg.id} 已存在且类型不同`);

        if (key === "") await creds.delete(cfg.id);
        else if (key !== undefined) await creds.modify(cfg.id, async () => ({ type: "api_key", key }));
        if (idx >= 0) stored.providers[idx] = cfg;
        else stored.providers.push(cfg);
        return { provider: toConfig({ cfg }) };
      }),

    "model.providerDelete": ({ providerId }) =>
      mutate(async () => {
        const idx = stored.providers.findIndex((p) => p.id === providerId);
        if (idx < 0) throw new HandlerError("not_found", find(providerId) ? "环境变量提供的配置不能删除" : `provider ${String(providerId)} 不存在`);
        stored.providers.splice(idx, 1);
        await creds.delete(providerId);
        const keep = (r?: ModelRef) => (r && r.provider !== providerId ? r : undefined);
        stored.settings = compact({ router: keep(stored.settings.router), native: keep(stored.settings.native) });
        return { ok: true as const };
      }),

    "model.list": async ({ providerId }) => {
      if (providerId && !find(providerId)) throw new HandlerError("not_found", `provider ${providerId} 不存在`);
      const targets = providerId ? [providerId] : effective().filter((e) => e.cfg.enabled).map((e) => e.cfg.id);
      const models = current;
      const dynamic = targets.filter((id) => models.getProvider(id)?.refreshModels);
      if (dynamic.length) await models.refresh({ providers: dynamic, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) }).catch(() => undefined);
      const out: ModelInfo[] = [];
      for (const id of targets) {
        const custom = find(id)?.cfg.kind !== "builtin";
        for (const m of models.getModels(id)) out.push(toInfo(id, m, custom));
      }
      return { models: out };
    },

    "model.test": async ({ ref }) => {
      if (!isRef(ref)) throw new HandlerError("bad_request", "ref 需要 provider 与 modelId");
      const e = find(ref.provider);
      if (!e) return { ok: false, error: `服务商 "${ref.provider}" 不存在，请先在设置里添加` };
      if (!e.cfg.enabled) return { ok: false, error: `服务商 "${e.cfg.name}" 已停用` };
      const models = current;
      const model = models.getModel(ref.provider, ref.modelId);
      if (!model) return { ok: false, error: `模型 "${ref.modelId}" 不在服务商 "${e.cfg.name}" 的模型列表中` };
      const secrets = [creds.peekKey(ref.provider), e.implicit?.key];
      const fail = (raw: string) => ({ ok: false as const, error: friendlyError(raw, { baseUrl: model.baseUrl, modelId: ref.modelId, secrets }) });
      try {
        if (!(await models.getAuth(model))) return { ok: false, error: `服务商 "${e.cfg.name}" 还没有配置 API Key` };
        const started = Date.now();
        const msg = await models.complete(model, { messages: [{ role: "user", content: "只回复 OK", timestamp: started }] }, { maxTokens: 32, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
        if (msg.stopReason === "error" || msg.stopReason === "aborted") return fail(msg.errorMessage ?? (msg.stopReason === "aborted" ? "timeout" : "请求失败"));
        const reply = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
        return { ok: true, latencyMs: Date.now() - started, reply: redact(reply, secrets).slice(0, 200) };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },

    "model.settingsSet": ({ settings }) =>
      mutate(async () => {
        const next: ModelSettings = {};
        for (const purpose of ["router", "native"] as const) {
          const ref = settings?.[purpose];
          if (ref === undefined) continue;
          if (!isRef(ref)) throw new HandlerError("bad_request", `${purpose} 需要 provider 与 modelId`);
          const e = find(ref.provider);
          if (!e) throw new HandlerError("bad_request", `服务商 "${ref.provider}" 不存在`);
          if (!e.cfg.enabled) throw new HandlerError("bad_request", `服务商 "${e.cfg.name}" 已停用，请先启用`);
          const p = current.getProvider(ref.provider);
          if (!p?.refreshModels && !current.getModel(ref.provider, ref.modelId)) throw new HandlerError("bad_request", `服务商 "${e.cfg.name}" 没有模型 "${ref.modelId}"`);
          next[purpose] = { provider: ref.provider, modelId: ref.modelId };
        }
        stored.settings = next;
      }).then(() => ({ settings: effectiveSettings() })),
  };

  // 启动：让 snapshot 带上 modelSettings（journal 可能留有旧值）。
  if (JSON.stringify(compact(hub.model.modelSettings ?? {})) !== JSON.stringify(effectiveSettings())) {
    hub.commit({ kind: "models.changed", settings: effectiveSettings() });
  }

  return {
    handlers,
    models: () => current,
    resolve(ref: ModelRefLike | undefined, purpose: "router" | "native") {
      const target = ref ?? effectiveSettings()[purpose];
      if (!target) return undefined;
      return find(target.provider)?.cfg.enabled ? { provider: target.provider, modelId: target.modelId } : undefined;
    },
    settings: (): ModelSettingsLike => effectiveSettings(),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

// ───────────── helpers ─────────────

function isRef(r: unknown): r is ModelRef {
  const x = r as ModelRef | null | undefined;
  return !!x && typeof x.provider === "string" && !!x.provider && typeof x.modelId === "string" && !!x.modelId;
}

function compact(s: ModelSettings): ModelSettings {
  return { ...(s.router ? { router: s.router } : {}), ...(s.native ? { native: s.native } : {}) };
}

/** undefined 保留；"" 清除；其余去首尾空白，内部不得含空白（会破坏请求头）。 */
function normalizeKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined) return undefined;
  if (typeof apiKey !== "string") throw new HandlerError("bad_request", "apiKey 必须是字符串");
  const key = apiKey.trim();
  if (/\s/.test(key)) throw new HandlerError("bad_request", "API Key 不能包含空格或换行，请检查是否多复制了内容");
  return key;
}

function cleanUrl(url: string | undefined, required: boolean): string | undefined {
  const v = url?.trim();
  if (!v) {
    if (required) throw new HandlerError("bad_request", "请填写 baseUrl，例如 http://localhost:11434/v1");
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new HandlerError("bad_request", `baseUrl 不是有效的网址：${v}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new HandlerError("bad_request", "baseUrl 必须以 http:// 或 https:// 开头");
  return v.replace(/\/+$/, "");
}

function uniqueIds(ids: string[] | undefined): string[] | undefined {
  if (!ids) return undefined;
  const out = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  return out.length ? out : undefined;
}

function toInfo(provider: string, m: Model<string>, custom: boolean): ModelInfo {
  return {
    provider,
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    vision: m.input.includes("image"),
    // 自定义端点的价格未知，不展示 0。
    ...(custom ? {} : { costInput: m.cost.input, costOutput: m.cost.output }),
  };
}
