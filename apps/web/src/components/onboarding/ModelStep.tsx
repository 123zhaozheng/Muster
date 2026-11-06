import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Plug, Zap } from "lucide-react";
import type { ModelInfo, ModelProviderConfig, ModelRef, ProviderCatalogEntry } from "@muster/protocol";
import { Badge, Button, Card, Combobox, Field, Input, cn, toast } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";
import { Heading } from "./Steps";

/** 快速选择里优先展示的 provider（目录里有才会出现）。 */
const PREFERRED = ["deepseek", "moonshot-cn", "zai-cn", "openai", "anthropic", "openrouter", "google"];

type Catalog = { phase: "loading" } | { phase: "ready"; providers: ProviderCatalogEntry[] };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refText = (r: ModelRef) => `${r.provider} / ${r.modelId}`;

/**
 * 引导中的“配置模型”：选内置 provider → 填 key → 连接并取模型 → 测试并保存为默认模型。
 * 只用 model.catalog / providerUpsert / list / test / settingsSet；key 只在这一次请求里出现，不落本地。
 * 可随时“稍后再说”。
 */
export function ModelStep({ onConfigured, onSkip }: { onConfigured?: (label: string) => void; onSkip?: () => void }) {
  const connected = useHub((s) => s.status === "open" && s.client !== null);
  const settings = useHub((s) => s.model.modelSettings);
  const existing = settings?.router ?? settings?.native;

  const [catalog, setCatalog] = useState<Catalog>({ phase: "loading" });
  const [providerId, setProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [link, setLink] = useState<{ config: ModelProviderConfig; models: ModelInfo[] } | null>(null);
  const [modelId, setModelId] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ ref: ModelRef; latencyMs?: number; reply?: string } | null>(null);

  const loadCatalog = useCallback(() => {
    let alive = true;
    setCatalog({ phase: "loading" });
    hubRequest("model.catalog", {})
      .then((r) => alive && setCatalog({ phase: "ready", providers: r.providers ?? [] }))
      .catch(() => alive && setCatalog({ phase: "ready", providers: [] }));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => (connected ? loadCatalog() : undefined), [connected, loadCatalog]);

  const providers = catalog.phase === "ready" ? catalog.providers : [];
  const entry = providers.find((p) => p.id === providerId);
  const quick = useMemo(() => {
    const picked = PREFERRED.map((id) => providers.find((p) => p.id === id)).filter((p): p is ProviderCatalogEntry => !!p);
    return (picked.length > 0 ? picked : providers).slice(0, 6);
  }, [providers]);
  const needKey = !!entry && !entry.envConfigured && apiKey.trim() === "";

  const reset = () => {
    setLink(null);
    setSaved(null);
    setError(null);
    setModelId("");
  };
  const pick = (id: string) => {
    setProviderId(id);
    setAttempted(false);
    reset();
  };

  const connect = async () => {
    if (!entry) return;
    setAttempted(true);
    if (needKey) return;
    setConnecting(true);
    setError(null);
    try {
      const { provider } = await hubRequest("model.providerUpsert", {
        provider: { id: entry.id, kind: "builtin", builtinId: entry.id, name: entry.name, enabled: true },
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const { models } = await hubRequest("model.list", { providerId: provider.id });
      setLink({ config: provider, models: models ?? [] });
      setModelId(models?.[0]?.id ?? "");
      setApiKey(""); // 不在页面里保留密钥
    } catch (e) {
      setError(`连接失败：${errText(e)}`);
    } finally {
      setConnecting(false);
    }
  };

  const testAndSave = async () => {
    if (!link || !modelId.trim()) return;
    const ref: ModelRef = { provider: link.config.id, modelId: modelId.trim() };
    setTesting(true);
    setError(null);
    try {
      const res = await hubRequest("model.test", { ref });
      if (!res.ok) {
        setError(`测试没通过：${res.error ?? "模型没有返回结果"}`);
        return;
      }
      await hubRequest("model.settingsSet", { settings: { ...(settings ?? {}), router: ref, native: ref } });
      setSaved({ ref, latencyMs: res.latencyMs, reply: res.reply });
      onConfigured?.(refText(ref));
      toast.success({ title: "模型已配置", description: refText(ref) });
    } catch (e) {
      setError(`保存失败：${errText(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Heading title="接入你的模型" hint="选一个服务商，填上自己的 API Key。密钥只保存在本机 daemon，永远不会发给页面。" />

      {existing && !saved && (
        <div className="muster-rise mb-4 flex items-center gap-2 rounded-2xl bg-mint-soft px-4 py-2.5 text-sm text-mint-deep">
          <CheckCircle2 className="size-4 shrink-0" />
          已配置默认模型：{refText(existing)}。你可以直接跳过，或在这里换一个。
        </div>
      )}

      <Card frosted className="p-6">
        {catalog.phase === "loading" ? (
          <p className="py-6 text-center text-sm text-ink-soft">正在读取服务商目录…</p>
        ) : providers.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-ink-soft">暂时没有读取到服务商目录（可能还没连上 daemon）。</p>
            <p className="mt-1 text-xs text-ink-faint">不影响使用，稍后可以在「设置 · 模型」里配置。</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={loadCatalog}>重新读取</Button>
          </div>
        ) : saved ? (
          <div className="muster-pop-in flex flex-col items-center gap-2 py-4 text-center" data-testid="model-saved">
            <span className="grid size-14 place-items-center rounded-full bg-mint-soft text-mint-deep"><CheckCircle2 className="size-8" /></span>
            <div className="text-[17px] font-semibold text-ink">模型已就绪</div>
            <div className="font-mono text-sm text-ink-soft">{refText(saved.ref)}</div>
            <div className="flex flex-wrap justify-center gap-2">
              {saved.latencyMs !== undefined && <Badge tone="mint">{saved.latencyMs} ms</Badge>}
              {saved.reply && <Badge tone="neutral">回复：{saved.reply.slice(0, 24)}</Badge>}
              <Badge tone="lavender">已设为 Pip 与原生成员的默认模型</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={reset}>换一个</Button>
          </div>
        ) : (
          <div className="grid gap-5">
            <div>
              <div className="mb-2 text-sm font-medium text-ink">服务商</div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label="快速选择服务商">
                {quick.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={providerId === p.id}
                    onClick={() => pick(p.id)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start rounded-2xl border px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-muster hover:-translate-y-0.5 active:scale-[0.98]",
                      providerId === p.id ? "border-coral bg-coral-soft shadow-glow-coral" : "border-line bg-surface hover:border-ink-faint/40 hover:shadow-soft",
                    )}
                  >
                    <span className="text-sm font-semibold text-ink">{p.name}</span>
                    <span className="text-xs text-ink-faint">{p.group ?? "内置"} · {p.modelCount} 个模型</span>
                  </button>
                ))}
              </div>
              {providers.length > quick.length && (
                <Combobox
                  className="mt-2.5"
                  aria-label="更多服务商"
                  placeholder={`更多服务商（共 ${providers.length} 个）`}
                  searchPlaceholder="搜索服务商"
                  options={providers.map((p) => ({ value: p.id, label: p.name, description: p.group, keywords: [p.id] }))}
                  value={providerId && !quick.some((q) => q.id === providerId) ? providerId : undefined}
                  onValueChange={pick}
                />
              )}
            </div>

            {entry && !link && (
              <div className="muster-rise grid gap-4">
                <Field
                  label="API Key"
                  htmlFor="ob-key"
                  required={!entry.envConfigured}
                  error={attempted && needKey ? "请填写 API Key" : undefined}
                  hint={entry.envConfigured ? `已在环境变量 ${entry.envVar ?? ""} 中检测到密钥，可以留空。` : entry.envVar ? `也可以提前设置环境变量 ${entry.envVar}。` : undefined}
                >
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                    <Input
                      id="ob-key"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void connect()}
                      aria-invalid={(attempted && needKey) || undefined}
                      placeholder="sk-…"
                      autoComplete="off"
                      className="pl-9 pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-canvas-deep hover:text-ink"
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
                <Button variant="primary" icon={<Plug className="size-4" />} loading={connecting} onClick={() => void connect()}>
                  连接并获取模型
                </Button>
              </div>
            )}

            {entry && link && (
              <div className="muster-rise grid gap-4">
                <div className="flex items-center gap-2 text-sm text-mint-deep">
                  <CheckCircle2 className="size-4" /> 已连接 {link.config.name}，找到 {link.models.length} 个模型
                </div>
                <Field label="模型" htmlFor="ob-model" hint={link.models.length === 0 ? "没有拿到模型列表，请手动输入模型 ID。" : "可以搜索，也能直接输入列表里没有的模型 ID。"}>
                  <Combobox
                    id="ob-model"
                    allowCustom
                    aria-label="模型"
                    placeholder="选择或输入模型"
                    searchPlaceholder="搜索模型"
                    options={link.models.map((m) => ({ value: m.id, label: m.name || m.id, description: m.id !== m.name ? m.id : undefined, keywords: [m.id] }))}
                    value={modelId}
                    onValueChange={setModelId}
                  />
                </Field>
                <Button variant="primary" icon={<Zap className="size-4" />} loading={testing} disabled={!modelId.trim()} onClick={() => void testAndSave()}>
                  测试并保存为默认模型
                </Button>
              </div>
            )}

            {error && <p role="alert" className="muster-fade-in rounded-2xl bg-danger-soft px-4 py-2.5 text-sm text-danger-deep">{error}</p>}
          </div>
        )}
      </Card>

      <div className="mt-4 text-center">
        <Button variant="ghost" size="sm" onClick={onSkip}>稍后再说，先逛逛</Button>
      </div>
    </div>
  );
}
