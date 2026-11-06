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
    <div className="mx-auto w-full max-w-xl">
      <Heading title="接入你的模型" hint="选一个服务商，填上自己的 API Key。密钥只保存在本机 daemon，永远不会发给页面。" />

      {existing && !saved && (
        <div className="mb-4 flex items-center gap-2 rounded-control bg-success-surface px-4 py-2.5 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          已配置默认模型：{refText(existing)}。你可以直接跳过，或在这里换一个。
        </div>
      )}

      <Card className="p-6">
        {catalog.phase === "loading" ? (
          <p className="py-6 text-center text-sm text-fg-2">正在读取服务商目录…</p>
        ) : providers.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-fg-2">暂时没有读取到服务商目录（可能还没连上 daemon）。</p>
            <p className="mt-1 text-xs text-fg-3">不影响使用，稍后可以在「设置 · 模型与连接」里配置。</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={loadCatalog}>重新读取</Button>
          </div>
        ) : saved ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center" data-testid="model-saved">
            <span className="grid size-10 place-items-center rounded-full bg-success-surface text-success"><CheckCircle2 className="size-6" /></span>
            <div className="text-section font-semibold text-fg">模型已就绪</div>
            <div className="font-mono text-sm text-fg-2">{refText(saved.ref)}</div>
            <div className="flex flex-wrap justify-center gap-2">
              {saved.latencyMs !== undefined && <Badge tone="success">{saved.latencyMs} ms</Badge>}
              {saved.reply && <Badge tone="neutral">回复：{saved.reply.slice(0, 24)}</Badge>}
              <Badge tone="neutral">已设为 Pip 与原生成员的默认模型</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={reset}>换一个</Button>
          </div>
        ) : (
          <div className="grid gap-5">
            <div>
              <div className="mb-2 text-sm font-medium text-fg">服务商</div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label="快速选择服务商">
                {quick.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={providerId === p.id}
                    onClick={() => pick(p.id)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start rounded-card border px-3.5 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      providerId === p.id ? "border-accent bg-accent-surface" : "border-border bg-surface hover:bg-surface-muted",
                    )}
                  >
                    <span className="text-sm font-semibold text-fg">{p.name}</span>
                    <span className="text-xs text-fg-3">{p.group ?? "内置"} · {p.modelCount} 个模型</span>
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
              <div className="grid gap-4">
                <Field
                  label="API Key"
                  htmlFor="ob-key"
                  required={!entry.envConfigured}
                  error={attempted && needKey ? "请填写 API Key" : undefined}
                  hint={entry.envConfigured ? `已在环境变量 ${entry.envVar ?? ""} 中检测到密钥，可以留空。` : entry.envVar ? `也可以提前设置环境变量 ${entry.envVar}。` : undefined}
                >
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
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
                      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-fg-3 transition-colors hover:bg-surface-muted hover:text-fg"
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
              <div className="grid gap-4">
                <div className="flex items-center gap-2 text-sm text-success">
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

            {error && <p role="alert" className="muster-fade-in rounded-control bg-danger-surface px-4 py-2.5 text-sm text-danger">{error}</p>}
          </div>
        )}
      </Card>

      <div className="mt-4 text-center">
        <Button variant="ghost" size="sm" onClick={onSkip}>稍后再说，先逛逛</Button>
      </div>
    </div>
  );
}
