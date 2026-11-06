// 模型配置的纯函数：分组、格式化、校验、请求参数组装。UI 与测试共用。
import type { ModelInfo, ModelProviderConfig, ModelRef, ModelSettings, ProviderCatalogEntry, ProviderKind } from "@muster/protocol";

export const GROUP_ORDER = ["国内", "国际", "聚合", "本地"] as const;

export const KIND_LABEL: Record<ProviderKind, string> = {
  builtin: "内置",
  "openai-compatible": "OpenAI 兼容",
  "anthropic-compatible": "Anthropic 兼容",
};

/** 目录按 国内 / 国际 / 聚合 / 本地 分组，其余归入“其他”。组内保持原顺序。 */
export function groupCatalog(entries: ProviderCatalogEntry[]): Array<{ group: string; items: ProviderCatalogEntry[] }> {
  const map = new Map<string, ProviderCatalogEntry[]>();
  for (const e of entries) {
    const g = e.group && (GROUP_ORDER as readonly string[]).includes(e.group) ? e.group : (e.group ?? "其他");
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(e);
  }
  const known = GROUP_ORDER.filter((g) => map.has(g));
  const rest = [...map.keys()].filter((g) => !(GROUP_ORDER as readonly string[]).includes(g));
  return [...known, ...rest].map((group) => ({ group, items: map.get(group)! }));
}

/** 首字母徽标（中文取首字，英文取首字母大写）。 */
export function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0]!.toUpperCase() : "?";
}

/** 128000 -> 128K；1048576 -> 1M。 */
export function formatContext(n?: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function usd(n: number): string {
  return `$${n >= 10 ? n.toFixed(0) : n.toFixed(2)}`;
}

/** 每百万 token 的美元价格：输入 / 输出。无数据时返回 “—”。 */
export function formatPrice(m: Pick<ModelInfo, "costInput" | "costOutput">): string {
  if (m.costInput == null && m.costOutput == null) return "—";
  return `${m.costInput != null ? usd(m.costInput) : "—"} / ${m.costOutput != null ? usd(m.costOutput) : "—"}`;
}

/** Select 里的小字：上下文 · 价格。 */
export function modelDetail(m: ModelInfo): string {
  const parts: string[] = [];
  if (m.contextWindow) parts.push(`${formatContext(m.contextWindow)} 上下文`);
  const price = formatPrice(m);
  if (price !== "—") parts.push(`${price} /百万 tokens`);
  return parts.join(" · ");
}

// ───────────── ModelRef <-> Select value ─────────────

export const NONE_VALUE = "__none__";

export function refToValue(ref?: ModelRef): string {
  return ref ? `${ref.provider}::${ref.modelId}` : NONE_VALUE;
}

export function valueToRef(v: string): ModelRef | undefined {
  if (v === NONE_VALUE) return undefined;
  const i = v.indexOf("::");
  return i < 0 ? undefined : { provider: v.slice(0, i), modelId: v.slice(i + 2) };
}

export function sameRef(a?: ModelRef, b?: ModelRef): boolean {
  return a?.provider === b?.provider && a?.modelId === b?.modelId;
}

/** 合并默认模型设置：ref 为 undefined 表示清除。 */
export function withSetting(settings: ModelSettings, key: keyof ModelSettings, ref?: ModelRef): ModelSettings {
  const next: ModelSettings = { ...settings };
  if (ref) next[key] = ref;
  else delete next[key];
  return next;
}

/** model.test 失败时给用户看的友好原因。 */
export function friendlyTestError(raw?: string): string {
  const e = (raw ?? "").trim();
  if (!e) return "请求没有成功，请检查 API Key 与网络。";
  if (/401|unauthori[sz]ed|invalid.*(api)?.?key|incorrect api key|authentication/i.test(e)) return "API Key 无效或没有权限（401）。请检查 Key 是否填对。";
  if (/403|forbidden/i.test(e)) return "没有访问该模型的权限（403）。请确认账户已开通此模型。";
  if (/404|not.?found/i.test(e)) return "地址或模型 ID 不存在（404）。请检查 Base URL 和模型 ID。";
  if (/429|rate.?limit|quota|insufficient|balance/i.test(e)) return "额度不足或请求太频繁（429）。请检查账户余额。";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|timed out|ETIMEDOUT/i.test(e)) return "连不上服务。请检查 Base URL、网络或代理。";
  if (/no api key|missing.*key|not configured/i.test(e)) return "还没有可用的 API Key。";
  return e.length > 160 ? `${e.slice(0, 160)}…` : e;
}

// ───────────── 自定义服务表单 ─────────────

export interface CustomForm {
  kind: Exclude<ProviderKind, "builtin">;
  name: string;
  baseUrl: string;
  modelIds: string[];
}
export type CustomErrors = Partial<Record<"name" | "baseUrl" | "modelIds", string>>;

export function validateCustom(f: CustomForm): CustomErrors {
  const errors: CustomErrors = {};
  if (!f.name.trim()) errors.name = "请给这个服务起个名字";
  const url = f.baseUrl.trim();
  if (!url) errors.baseUrl = "请填写 Base URL";
  else {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.baseUrl = "地址需要以 http:// 或 https:// 开头";
    } catch {
      errors.baseUrl = "这不是有效的地址，例如 https://api.example.com/v1";
    }
  }
  if (f.modelIds.length === 0) errors.modelIds = "至少添加一个模型 ID";
  return errors;
}

/** 把用户输入（逗号 / 空白 / 换行分隔）拆成去重后的模型 ID。 */
export function splitModelIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,，;；]+/).map((s) => s.trim()).filter(Boolean))];
}

export type UpsertParams = { provider: ProviderUpsertInput; apiKey?: string };
export type ProviderUpsertInput = Omit<ModelProviderConfig, "id" | "hasApiKey" | "createdAt"> & { id?: string };

/** 内置 provider：只需 API Key。 */
export function builtinUpsert(entry: ProviderCatalogEntry, apiKey: string, existing?: ModelProviderConfig): UpsertParams {
  const key = apiKey.trim();
  return {
    provider: {
      id: entry.id,
      kind: "builtin",
      builtinId: entry.id,
      name: existing?.name ?? entry.name,
      ...(existing?.baseUrl ?? entry.baseUrl ? { baseUrl: existing?.baseUrl ?? entry.baseUrl } : {}),
      enabled: existing?.enabled ?? true,
      ...(existing?.modelIds ? { modelIds: existing.modelIds } : {}),
    },
    ...(key ? { apiKey: key } : {}),
  };
}

/** 自定义兼容服务。apiKey：空串不发送（保持不变）；clearKey 时发送 ""。 */
export function customUpsert(f: CustomForm, apiKey: string, opts: { id?: string; enabled?: boolean; clearKey?: boolean } = {}): UpsertParams {
  const key = apiKey.trim();
  return {
    provider: {
      ...(opts.id ? { id: opts.id } : {}),
      kind: f.kind,
      name: f.name.trim(),
      baseUrl: f.baseUrl.trim(),
      enabled: opts.enabled ?? true,
      modelIds: f.modelIds,
    },
    ...(opts.clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
  };
}

/** 现有配置 -> upsert 入参（用于启用开关等不改 key 的更新）。 */
export function configToUpsert(p: ModelProviderConfig, patch: Partial<Pick<ModelProviderConfig, "enabled">> = {}): UpsertParams {
  return {
    provider: {
      id: p.id,
      kind: p.kind,
      ...(p.builtinId ? { builtinId: p.builtinId } : {}),
      name: p.name,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      enabled: patch.enabled ?? p.enabled,
      ...(p.modelIds ? { modelIds: p.modelIds } : {}),
    },
  };
}
