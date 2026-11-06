// pi-ai 内置 provider 目录的静态元数据：分组、环境变量名（pi-ai 未导出 env 映射，这里按其 README 抄一份作提示与隐式 provider 检测）。
import type { ProviderCatalogEntry } from "@muster/protocol";

export type CatalogGroup = "国内" | "国际" | "聚合" | "云厂商" | "本地";

const GROUP_ORDER: CatalogGroup[] = ["国内", "国际", "聚合", "云厂商", "本地"];

const CN = new Set([
  "deepseek", "moonshotai-cn", "minimax-cn", "zai-coding-cn", "kimi-coding", "ant-ling",
  "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual", "qwen-token-plan-individual-cn",
  "xiaomi", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp",
]);
const AGGREGATOR = new Set(["openrouter", "vercel-ai-gateway", "together", "fireworks", "huggingface", "opencode", "opencode-go", "cloudflare-ai-gateway"]);
const CLOUD = new Set(["amazon-bedrock", "azure", "google-vertex", "cloudflare-workers-ai"]);
const LOCAL = new Set(["llamacpp", "ollama", "lmstudio", "vllm"]);

/** 按 id 归类（未列出的一律“国际”）。 */
export function groupOf(id: string): CatalogGroup {
  if (CN.has(id)) return "国内";
  if (AGGREGATOR.has(id)) return "聚合";
  if (CLOUD.has(id)) return "云厂商";
  if (LOCAL.has(id)) return "本地";
  return "国际";
}

/** pi-ai 为各 provider 读取的 API key 环境变量（第一个为展示用）。 */
export const ENV_VARS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
  "ant-ling": ["ANT_LING_API_KEY"],
  azure: ["AZURE_OPENAI_API_KEY"],
  radius: ["RADIUS_API_KEY"],
  typesafe: ["TYPESAFE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY"],
  xai: ["XAI_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  baseten: ["BASETEN_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  huggingface: ["HF_TOKEN"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  meta: ["META_API_KEY"],
  "qwen-token-plan": ["QWEN_TOKEN_PLAN_API_KEY"],
  "qwen-token-plan-individual": ["QWEN_TOKEN_PLAN_API_KEY"],
  "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
  "qwen-token-plan-individual-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
  "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN"],
};

/** 环境变量里是否有该 provider 的 key（仅看是否非空）。 */
export function envKeyOf(id: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const name of ENV_VARS[id] ?? []) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** 国内优先、组内按名称排序。 */
export function sortCatalog(entries: ProviderCatalogEntry[]): ProviderCatalogEntry[] {
  const rank = (e: ProviderCatalogEntry) => GROUP_ORDER.indexOf((e.group as CatalogGroup | undefined) ?? "国际");
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
