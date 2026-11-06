// 仅供设置页 / 技能页测试使用：带 model.* 的假 daemon。
import { vi } from "vitest";
import type { MethodName, ModelInfo, ModelProviderConfig, ModelSettings, ProviderCatalogEntry } from "@muster/protocol";
import { snapshot } from "@muster/protocol/fixtures";
import { modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";
import { agents } from "./testSetup";

export const CATALOG: ProviderCatalogEntry[] = [
  { id: "deepseek", name: "DeepSeek", envVar: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com", modelCount: 2, envConfigured: false, group: "国内" },
  { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", modelCount: 3, envConfigured: true, group: "国际" },
  { id: "openrouter", name: "OpenRouter", envVar: "OPENROUTER_API_KEY", modelCount: 9, envConfigured: false, group: "聚合" },
];

const MODELS: ModelInfo[] = [
  { provider: "moonshot", id: "kimi-k2", name: "Kimi K2", contextWindow: 128000, costInput: 0.6, costOutput: 2.5, reasoning: true },
  { provider: "moonshot", id: "kimi-vl", name: "Kimi VL", contextWindow: 32000, vision: true },
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat", contextWindow: 64000 },
];

export const EXISTING: ModelProviderConfig = {
  id: "moonshot", kind: "builtin", builtinId: "moonshot", name: "Moonshot", hasApiKey: true, enabled: true, createdAt: "2026-11-06T00:00:00.000Z",
};

export interface FakeDaemon {
  request: ReturnType<typeof vi.fn>;
  state: { providers: ModelProviderConfig[]; settings: ModelSettings };
}

/** 灌入 fixtures 并装上假 client。`initial` 可预置已配置的 provider。 */
export function setupModelHub(initial: { providers?: ModelProviderConfig[]; settings?: ModelSettings; testOk?: boolean } = {}): FakeDaemon {
  const state = { providers: [...(initial.providers ?? [EXISTING])], settings: { ...(initial.settings ?? {}) } };
  const request = vi.fn(async (method: MethodName, params: never) => {
    const p = params as Record<string, any>;
    switch (method) {
      case "bot.detectAgents": return { agents };
      case "model.catalog": return { providers: CATALOG };
      case "model.providers": return { providers: state.providers, settings: state.settings };
      case "model.list": return { models: p.providerId ? MODELS.filter((m) => m.provider === p.providerId) : MODELS };
      case "model.settingsSet": state.settings = p.settings; return { settings: state.settings };
      case "model.providerUpsert": {
        const id = p.provider.id ?? "custom-1234";
        const old = state.providers.find((x) => x.id === id);
        const hasApiKey = p.apiKey === undefined ? (old?.hasApiKey ?? false) : p.apiKey !== "";
        const next: ModelProviderConfig = { ...p.provider, id, hasApiKey, createdAt: old?.createdAt ?? "2026-11-06T00:00:00.000Z" };
        state.providers = [...state.providers.filter((x) => x.id !== id), next];
        return { provider: next };
      }
      case "model.providerDelete": state.providers = state.providers.filter((x) => x.id !== p.providerId); return { ok: true };
      case "model.test": return initial.testOk === false ? { ok: false, error: "401 Unauthorized" } : { ok: true, latencyMs: 321, reply: "OK" };
      default: return {};
    }
  });
  const client = { request, onPush: () => () => undefined, onStatus: () => () => undefined, close: () => undefined } as unknown as MusterClient;
  localStorage.clear();
  useHub.setState({ model: modelFromSnapshot(structuredClone(snapshot)), status: "open", client, mock: false, loadedThreads: {} });
  return { request, state };
}

/** Radix Select / Popover 在 jsdom 里需要的几个浏览器 API。 */
export function polyfillDom(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
