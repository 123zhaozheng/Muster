// Mock 版"模型目录"：仿 pi-ai 内置 provider 目录（id / 分组 / 环境变量与真实 daemon 的 models/catalog.ts 对齐）。
// 价格单位：美元 / 百万 token。仅用于演示模式，不要求与上游逐项一致。
import type { ModelInfo, ProviderCatalogEntry } from "@muster/protocol";

export type MockModel = Omit<ModelInfo, "provider">;

const m = (id: string, name: string, contextWindow: number, maxTokens: number, reasoning: boolean, vision: boolean, costInput: number, costOutput: number): MockModel => ({
  id, name, contextWindow, maxTokens, reasoning, vision, costInput, costOutput,
});

type Entry = Omit<ProviderCatalogEntry, "envConfigured">;

const entry = (id: string, name: string, group: string, modelCount: number, envVar?: string, baseUrl?: string): Entry => ({
  id, name, group, modelCount, ...(envVar ? { envVar } : {}), ...(baseUrl ? { baseUrl } : {}),
});

/** 国内优先，其次国际 / 聚合 / 云厂商 / 本地。 */
export const MOCK_CATALOG: Entry[] = [
  entry("deepseek", "DeepSeek", "国内", 6, "DEEPSEEK_API_KEY", "https://api.deepseek.com"),
  entry("moonshotai-cn", "Moonshot (China)", "国内", 12, "MOONSHOT_API_KEY", "https://api.moonshot.cn/v1"),
  entry("minimax-cn", "MiniMax (China)", "国内", 8, "MINIMAX_CN_API_KEY", "https://api.minimaxi.com/v1"),
  entry("zai", "智谱 ZAI", "国内", 14, "ZAI_API_KEY", "https://open.bigmodel.cn/api/paas/v4"),
  entry("zai-coding-cn", "智谱 ZAI Coding (China)", "国内", 7, "ZAI_CODING_CN_API_KEY", "https://open.bigmodel.cn/api/coding/paas/v4"),
  entry("qwen-token-plan-cn", "Qwen Token Plan (China)", "国内", 24, "QWEN_TOKEN_PLAN_CN_API_KEY", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
  entry("kimi-coding", "Kimi Coding", "国内", 3, "KIMI_API_KEY", "https://api.kimi.com/coding/v1"),
  entry("xiaomi", "Xiaomi MiMo", "国内", 4, "XIAOMI_API_KEY"),
  entry("openai", "OpenAI", "国际", 42, "OPENAI_API_KEY", "https://api.openai.com/v1"),
  entry("anthropic", "Anthropic", "国际", 18, "ANTHROPIC_API_KEY", "https://api.anthropic.com"),
  entry("google", "Google Gemini", "国际", 26, "GEMINI_API_KEY", "https://generativelanguage.googleapis.com"),
  entry("xai", "xAI", "国际", 9, "XAI_API_KEY", "https://api.x.ai/v1"),
  entry("mistral", "Mistral", "国际", 15, "MISTRAL_API_KEY", "https://api.mistral.ai/v1"),
  entry("groq", "Groq", "国际", 16, "GROQ_API_KEY", "https://api.groq.com/openai/v1"),
  entry("openrouter", "OpenRouter", "聚合", 240, "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1"),
  entry("together", "Together AI", "聚合", 38, "TOGETHER_API_KEY", "https://api.together.xyz/v1"),
  entry("fireworks", "Fireworks", "聚合", 21, "FIREWORKS_API_KEY", "https://api.fireworks.ai/inference/v1"),
  entry("vercel-ai-gateway", "Vercel AI Gateway", "聚合", 110, "AI_GATEWAY_API_KEY", "https://ai-gateway.vercel.sh/v1"),
  entry("amazon-bedrock", "Amazon Bedrock", "云厂商", 31),
  entry("azure", "Azure OpenAI", "云厂商", 20, "AZURE_OPENAI_API_KEY"),
  entry("ollama", "Ollama（本地）", "本地", 0, undefined, "http://localhost:11434/v1"),
  entry("lmstudio", "LM Studio（本地）", "本地", 0, undefined, "http://localhost:1234/v1"),
];

export const MOCK_MODELS: Record<string, MockModel[]> = {
  deepseek: [
    m("deepseek-flash", "DeepSeek V4.1 Flash", 1_000_000, 384_000, true, false, 0.3, 1.2),
    m("deepseek-v4-pro", "DeepSeek V4 Pro", 1_000_000, 384_000, true, false, 1.32, 3.96),
    m("deepseek-chat", "DeepSeek Chat", 128_000, 8_192, false, false, 0.28, 0.42),
  ],
  "moonshotai-cn": [
    m("kimi-k3", "Kimi K3", 1_048_576, 1_048_576, true, true, 3, 15),
    m("kimi-k2.6", "Kimi K2.6", 262_144, 262_144, true, false, 0.97, 4.03),
    m("kimi-k2.7-code", "Kimi K2.7 Code", 262_144, 262_144, true, false, 0.97, 4.03),
  ],
  "minimax-cn": [
    m("MiniMax-M3", "MiniMax-M3", 1_000_000, 524_288, true, false, 0.31, 1.25),
    m("MiniMax-M2.7", "MiniMax-M2.7", 204_800, 131_072, true, false, 0.31, 1.25),
    m("MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash", 1_000_000, 524_288, true, false, 0.15, 0.6),
  ],
  zai: [
    m("glm-5.3", "GLM-5.3", 1_000_000, 131_072, true, false, 1.4, 4.4),
    m("glm-5.3-flash", "GLM-5.3-Flash", 1_000_000, 131_072, true, false, 0.15, 0.5),
    m("glm-4.7", "GLM-4.7", 204_800, 131_072, true, false, 0.6, 2.2),
  ],
  "zai-coding-cn": [
    m("glm-5.3", "GLM-5.3", 1_000_000, 131_072, true, false, 1.4, 4.4),
    m("glm-4.7", "GLM-4.7", 204_800, 131_072, true, false, 0.6, 2.2),
  ],
  "qwen-token-plan-cn": [
    m("qwen3-max", "Qwen3 Max", 262_144, 65_536, true, false, 1.2, 6),
    m("qwen3-coder-plus", "Qwen3 Coder Plus", 1_000_000, 65_536, false, false, 1, 5),
    m("qwen-vl-max", "Qwen VL Max", 131_072, 8_192, false, true, 0.8, 3.2),
    m("qwen-turbo", "Qwen Turbo", 1_000_000, 16_384, false, false, 0.05, 0.2),
  ],
  "kimi-coding": [m("kimi-for-coding", "Kimi for Coding", 262_144, 32_768, true, false, 0, 0), m("kimi-k2.6", "Kimi K2.6", 262_144, 262_144, true, false, 0.97, 4.03)],
  xiaomi: [m("mimo-v2-flash", "MiMo V2 Flash", 262_144, 65_536, true, false, 0.1, 0.3), m("mimo-v2-pro", "MiMo V2 Pro", 1_000_000, 131_072, true, false, 1, 3)],
  openai: [
    m("gpt-4.1", "GPT-4.1", 1_047_576, 32_768, false, true, 2, 8),
    m("gpt-4.1-mini", "GPT-4.1 mini", 1_047_576, 32_768, false, true, 0.4, 1.6),
    m("o4-mini", "o4-mini", 200_000, 100_000, true, true, 1.1, 4.4),
    m("chat-latest", "Chat Latest", 400_000, 128_000, true, true, 5, 30),
  ],
  anthropic: [
    m("claude-opus-4-5", "Claude Opus 4.5", 200_000, 64_000, true, true, 5, 25),
    m("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, 64_000, true, true, 3, 15),
    m("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, 64_000, true, true, 1, 5),
  ],
  google: [
    m("gemini-2.5-pro", "Gemini 2.5 Pro", 1_048_576, 65_536, true, true, 1.25, 10),
    m("gemini-2.5-flash", "Gemini 2.5 Flash", 1_048_576, 65_536, true, true, 0.3, 2.5),
    m("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", 1_048_576, 65_536, true, true, 0.1, 0.4),
  ],
  xai: [m("grok-4", "Grok 4", 256_000, 64_000, true, true, 3, 15), m("grok-4-fast", "Grok 4 Fast", 2_000_000, 30_000, true, true, 0.2, 0.5)],
  mistral: [m("mistral-large-latest", "Mistral Large", 128_000, 32_768, false, false, 2, 6), m("codestral-latest", "Codestral", 256_000, 32_768, false, false, 0.3, 0.9)],
  groq: [m("llama-3.3-70b-versatile", "Llama 3.3 70B", 131_072, 32_768, false, false, 0.59, 0.79), m("openai/gpt-oss-120b", "GPT-OSS 120B", 131_072, 65_536, true, false, 0.15, 0.6)],
  openrouter: [
    m("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", 200_000, 64_000, true, true, 3, 15),
    m("deepseek/deepseek-chat-v3.1", "DeepSeek Chat V3.1", 163_840, 32_768, true, false, 0.2, 0.8),
    m("google/gemini-2.5-flash", "Gemini 2.5 Flash", 1_048_576, 65_536, true, true, 0.3, 2.5),
    m("openai/gpt-4.1-mini", "GPT-4.1 mini", 1_047_576, 32_768, false, true, 0.4, 1.6),
  ],
  together: [m("meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B Turbo", 131_072, 8_192, false, false, 0.88, 0.88), m("Qwen/Qwen3-235B-A22B", "Qwen3 235B A22B", 131_072, 32_768, true, false, 0.2, 0.6)],
  fireworks: [m("accounts/fireworks/models/deepseek-v3", "DeepSeek V3", 128_000, 16_384, false, false, 0.9, 0.9), m("accounts/fireworks/models/kimi-k2-instruct", "Kimi K2 Instruct", 131_072, 16_384, false, false, 0.6, 2.5)],
  "vercel-ai-gateway": [m("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", 200_000, 64_000, true, true, 3, 15), m("openai/gpt-4.1", "GPT-4.1", 1_047_576, 32_768, false, true, 2, 8)],
  "amazon-bedrock": [m("anthropic.claude-sonnet-4-5-v1:0", "Claude Sonnet 4.5 (Bedrock)", 200_000, 64_000, true, true, 3, 15), m("amazon.nova-pro-v1:0", "Amazon Nova Pro", 300_000, 5_120, false, true, 0.8, 3.2)],
  azure: [m("gpt-4.1", "GPT-4.1 (Azure)", 1_047_576, 32_768, false, true, 2, 8), m("gpt-4.1-mini", "GPT-4.1 mini (Azure)", 1_047_576, 32_768, false, true, 0.4, 1.6)],
  // 本地：模型随用户机器而定，演示给两个常见的；价格为 0
  ollama: [m("qwen3:8b", "qwen3:8b", 40_960, 8_192, true, false, 0, 0), m("llama3.1:8b", "llama3.1:8b", 131_072, 8_192, false, false, 0, 0)],
  lmstudio: [m("qwen/qwen3-8b", "qwen/qwen3-8b", 40_960, 8_192, true, false, 0, 0)],
};

/** 不需要 API Key 的 provider（本地推理）。 */
export const KEYLESS_PROVIDERS = new Set(["ollama", "lmstudio"]);
