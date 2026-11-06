// 原生 Bot 的模型配置：从环境变量解析出 pi-ai 的 Models 与默认模型引用。
import type { Model } from "@earendil-works/pi-ai";
import { createModels, createProvider, type Models } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

export interface NativeModelRef {
  provider: string;
  modelId: string;
}

/** 解析结果：一个已注册好 provider 的 Models，以及默认使用的模型。 */
export interface NativeModelSetup {
  models: Models;
  model: NativeModelRef;
}

const CUSTOM_PROVIDER_ID = "muster-native";

/**
 * 读取模型配置，未配置时抛错（app.ts 据此回退到 fake 驱动）。
 * - MUSTER_NATIVE_MODEL（必填）+ MUSTER_NATIVE_BASE_URL（+ 可选 MUSTER_NATIVE_API_KEY）：OpenAI 兼容端点（chat completions）。
 * - MUSTER_NATIVE_MODEL + OPENAI_API_KEY（无 BASE_URL）：pi-ai 内置 OpenAI provider（Responses API）。
 */
export function resolveNativeModel(env: NodeJS.ProcessEnv = process.env): NativeModelSetup {
  const modelId = env.MUSTER_NATIVE_MODEL?.trim();
  const baseUrl = env.MUSTER_NATIVE_BASE_URL?.trim();
  const apiKey = env.MUSTER_NATIVE_API_KEY?.trim();
  if (!modelId) throw new Error("原生 Bot 未配置模型：请设置 MUSTER_NATIVE_MODEL（以及 MUSTER_NATIVE_BASE_URL / MUSTER_NATIVE_API_KEY）");

  const models = createModels();
  if (baseUrl) {
    const model: Model<"openai-completions"> = {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: CUSTOM_PROVIDER_ID,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_000,
    };
    models.setProvider(
      createProvider({
        id: CUSTOM_PROVIDER_ID,
        name: "Muster 原生 Bot",
        baseUrl,
        // pi-ai 即使对本地服务也要求有 key（否则报 “No API key for provider”）；没配就发一个占位值，本地服务会忽略它。
        auth: { apiKey: { name: "MUSTER_NATIVE_API_KEY", resolve: async () => ({ auth: { apiKey: apiKey || "not-needed" } }) } },
        models: [model],
        api: openAICompletionsApi(),
      }),
    );
    return { models, model: { provider: CUSTOM_PROVIDER_ID, modelId } };
  }

  if (!env.OPENAI_API_KEY?.trim()) throw new Error("原生 Bot 未配置模型：请设置 MUSTER_NATIVE_BASE_URL（+ MUSTER_NATIVE_API_KEY），或 OPENAI_API_KEY");
  const provider = openaiProvider();
  models.setProvider(provider);
  if (!models.getModel(provider.id, modelId)) throw new Error(`OpenAI 目录中没有模型 ${modelId}；自定义模型请设置 MUSTER_NATIVE_BASE_URL`);
  return { models, model: { provider: provider.id, modelId } };
}
