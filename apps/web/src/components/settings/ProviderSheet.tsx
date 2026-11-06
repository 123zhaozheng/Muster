import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, KeyRound, Plug, Trash2, Zap } from "lucide-react";
import type { ModelProviderConfig, ProviderCatalogEntry } from "@muster/protocol";
import { Button, Badge, Field, Input, Segmented, Drawer, DrawerContent, cn, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { TagInput } from "./TagInput";
import {
  builtinUpsert, customUpsert, friendlyTestError, groupCatalog, initialOf, KIND_LABEL, validateCustom,
  type CustomErrors, type CustomForm, type UpsertParams,
} from "./modelMeta";

type Mode = "catalog" | "custom";
type TestState = { phase: "idle" } | { phase: "running" } | { phase: "done"; ok: boolean; latencyMs?: number; reply?: string; error?: string };

/** 首字母徽标：中性底色，不用品牌色。 */
export function ProviderBadge({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-control bg-surface-muted font-semibold text-fg-2" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initialOf(name)}
    </span>
  );
}

const EMPTY_CUSTOM: CustomForm = { kind: "openai-compatible", name: "", baseUrl: "", modelIds: [] };

export interface ProviderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ProviderCatalogEntry[];
  providers: ModelProviderConfig[];
  /** 传入则为编辑模式。 */
  editing?: ModelProviderConfig | null;
  /** 保存（或测试时的暂存）成功后调用，用于刷新列表。 */
  onSaved: () => void | Promise<void>;
}

export function ProviderSheet({ open, onOpenChange, catalog, providers, editing, onSaved }: ProviderSheetProps) {
  const [mode, setMode] = useState<Mode>("catalog");
  const [picked, setPicked] = useState<ProviderCatalogEntry | undefined>();
  const [custom, setCustom] = useState<CustomForm>(EMPTY_CUSTOM);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [errors, setErrors] = useState<CustomErrors & { apiKey?: string }>({});
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  // 测试连接会先把配置存下来，之后的保存都更新同一个 provider。
  const [saved, setSaved] = useState<ModelProviderConfig | undefined>();

  // 每次打开都从头开始。
  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setClearKey(false);
    setErrors({});
    setTest({ phase: "idle" });
    setSaved(undefined);
    setSaving(false);
    if (editing) {
      if (editing.kind === "builtin") {
        setPicked(catalog.find((c) => c.id === (editing.builtinId ?? editing.id)) ?? { id: editing.id, name: editing.name, modelCount: editing.modelIds?.length ?? 0, envConfigured: false, baseUrl: editing.baseUrl });
        setMode("catalog");
      } else {
        setPicked(undefined);
        setMode("custom");
        setCustom({ kind: editing.kind, name: editing.name, baseUrl: editing.baseUrl ?? "", modelIds: editing.modelIds ?? [] });
      }
    } else {
      setPicked(undefined);
      setMode("catalog");
      setCustom(EMPTY_CUSTOM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开 / 切换编辑对象时重置
  }, [open, editing?.id]);

  const current = saved ?? editing ?? undefined;
  const isEdit = !!current;
  const hasKey = current?.hasApiKey ?? false;
  const configured = useMemo(() => new Set(providers.map((p) => p.builtinId ?? p.id)), [providers]);
  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const isBuiltinForm = mode === "catalog" && !!picked;
  const showForm = mode === "custom" || isBuiltinForm;

  /** 校验并组装 providerUpsert 参数；校验失败返回 null。 */
  const build = (): UpsertParams | null => {
    if (mode === "custom") {
      const errs = validateCustom(custom);
      setErrors(errs);
      if (Object.keys(errs).length > 0) return null;
      return customUpsert(custom, apiKey, { id: current?.id, enabled: current?.enabled ?? true, clearKey });
    }
    if (!picked) return null;
    const needKey = !hasKey && !picked.envConfigured && picked.group !== "本地";
    if (needKey && !apiKey.trim()) {
      setErrors({ apiKey: "请填写 API Key" });
      return null;
    }
    setErrors({});
    const p = builtinUpsert(picked, apiKey, current);
    return clearKey ? { ...p, apiKey: "" } : p;
  };

  const persist = async (params: UpsertParams): Promise<ModelProviderConfig> => {
    const { provider } = await hubRequest("model.providerUpsert", params);
    setSaved(provider);
    setApiKey("");
    setClearKey(false);
    await onSaved();
    return provider;
  };

  const onSave = async () => {
    const params = build();
    if (!params) return;
    setSaving(true);
    try {
      const p = await persist(params);
      toast.success({ title: isEdit ? `已更新 ${p.name}` : `已添加 ${p.name}`, description: p.hasApiKey ? undefined : "还没有设置 API Key，可稍后编辑补上" });
      onOpenChange(false);
    } catch (e) {
      toast.error({ title: "保存失败", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    const params = build();
    if (!params) return;
    setTest({ phase: "running" });
    try {
      const p = await persist(params);
      let modelId = p.modelIds?.[0] ?? custom.modelIds[0];
      if (!modelId || p.kind === "builtin") {
        const { models } = await hubRequest("model.list", { providerId: p.id });
        modelId = p.modelIds?.[0] ?? models[0]?.id;
      }
      if (!modelId) {
        setTest({ phase: "done", ok: false, error: "这个服务下没有可测试的模型。" });
        return;
      }
      const r = await hubRequest("model.test", { ref: { provider: p.id, modelId } });
      setTest({ phase: "done", ok: r.ok, latencyMs: r.latencyMs, reply: r.reply, error: r.ok ? undefined : friendlyTestError(r.error) });
    } catch (e) {
      setTest({ phase: "done", ok: false, error: friendlyTestError(e instanceof Error ? e.message : String(e)) });
    }
  };

  const title = isEdit ? `编辑 ${current!.name}` : "添加模型服务";
  const busy = saving || test.phase === "running";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        width={580}
        title={title}
        description={isEdit ? "Key 留空表示不修改；Key 只保存在本机 daemon，不会回显。" : "从内置目录里选一个，或接入任意 OpenAI / Anthropic 兼容的服务。"}
        footer={
          showForm ? (
            <div className="flex w-full items-center gap-2">
              <Button variant="secondary" icon={<Plug className="size-4" />} loading={test.phase === "running"} disabled={saving} onClick={onTest}>测试连接</Button>
              <span className="flex-1" />
              <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
              <Button variant="primary" loading={saving} disabled={test.phase === "running"} onClick={onSave}>保存</Button>
            </div>
          ) : undefined
        }
      >
        <div className="grid gap-5 p-6">
          {!isEdit && (
            <Segmented<Mode>
              value={mode}
              onChange={(v) => {
                setMode(v);
                setErrors({});
                setTest({ phase: "idle" });
              }}
              options={[{ value: "catalog", label: "从内置目录选" }, { value: "custom", label: "自定义兼容服务" }]}
            />
          )}

          {mode === "catalog" && !picked && (
            <div className="grid gap-5">
              {groups.length === 0 && <p className="text-sm text-fg-2">目录为空。</p>}
              {groups.map(({ group, items }) => (
                <div key={group}>
                  <div className="mb-2 text-xs font-medium text-fg-3">{group}</div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {items.map((c) => {
                      const added = configured.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={added}
                          onClick={() => setPicked(c)}
                          aria-label={`选择 ${c.name}`}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-card border border-border bg-surface p-3 text-left transition-colors duration-150",
                            "hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border",
                          )}
                        >
                          <ProviderBadge name={c.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{c.name}</span>
                            <span className="block text-xs text-fg-3">{c.modelCount} 个模型</span>
                            {c.envConfigured && !added && <span className="mt-0.5 block text-xs text-success" title={c.envVar}>已检测到环境变量</span>}
                          </span>
                          {added && <Badge tone="success" icon={<Check className="size-3" />}>已添加</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isBuiltinForm && picked && (
            <div className="grid gap-5">
              <div className="flex items-center gap-3 rounded-card bg-surface-muted p-3.5">
                <ProviderBadge name={picked.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-fg">{picked.name}</div>
                  <div className="truncate font-mono text-xs text-fg-3">{picked.baseUrl ?? picked.id}</div>
                </div>
                {!isEdit && (
                  <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => { setPicked(undefined); setErrors({}); setApiKey(""); setTest({ phase: "idle" }); }}>
                    重新选择
                  </Button>
                )}
              </div>
              {picked.envConfigured && (
                <div className="rounded-control bg-success-surface px-4 py-2.5 text-sm text-success">
                  已检测到环境变量 <span className="font-mono">{picked.envVar}</span>，Key 可以留空直接使用。
                </div>
              )}
              <KeyField
                value={apiKey}
                onChange={setApiKey}
                hasKey={hasKey}
                clearKey={clearKey}
                onToggleClear={() => setClearKey((v) => !v)}
                error={errors.apiKey}
                hint={picked.envVar && !picked.envConfigured ? `也可以通过环境变量 ${picked.envVar} 提供` : undefined}
                required={!isEdit && !picked.envConfigured && picked.group !== "本地"}
              />
            </div>
          )}

          {mode === "custom" && (
            <div className="grid gap-5">
              <Field label="接口类型">
                <Segmented<CustomForm["kind"]>
                  value={custom.kind}
                  onChange={(kind) => setCustom((f) => ({ ...f, kind }))}
                  options={[
                    { value: "openai-compatible", label: KIND_LABEL["openai-compatible"] },
                    { value: "anthropic-compatible", label: KIND_LABEL["anthropic-compatible"] },
                  ]}
                />
              </Field>
              <Field label="名称" htmlFor="prov-name" required error={errors.name}>
                <Input id="prov-name" value={custom.name} aria-invalid={!!errors.name || undefined} placeholder="例如 公司网关、本地 Ollama" onChange={(e) => setCustom((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Base URL" htmlFor="prov-url" required error={errors.baseUrl} hint="OpenAI 兼容通常以 /v1 结尾，如 http://localhost:11434/v1">
                <Input id="prov-url" className="font-mono text-[13px]" value={custom.baseUrl} aria-invalid={!!errors.baseUrl || undefined} placeholder="https://api.example.com/v1" onChange={(e) => setCustom((f) => ({ ...f, baseUrl: e.target.value }))} />
              </Field>
              <KeyField value={apiKey} onChange={setApiKey} hasKey={hasKey} clearKey={clearKey} onToggleClear={() => setClearKey((v) => !v)} optionalHint="本地服务（如 Ollama）可不填" />
              <Field label="模型 ID" htmlFor="prov-models" required error={errors.modelIds} hint="回车或逗号确认，可添加多个；也可以一次粘贴多个。">
                <TagInput id="prov-models" value={custom.modelIds} invalid={!!errors.modelIds} placeholder="例如 qwen2.5-coder:7b" onChange={(modelIds) => setCustom((f) => ({ ...f, modelIds }))} />
              </Field>
            </div>
          )}

          {showForm && test.phase === "done" && (
            <div
              role="status"
              className={cn("muster-fade-in rounded-control px-4 py-3 text-sm", test.ok ? "bg-success-surface text-success" : "bg-danger-surface text-danger")}
            >
              {test.ok ? (
                <>
                  <div className="font-medium">连接成功{test.latencyMs != null ? ` · ${test.latencyMs} ms` : ""}</div>
                  {test.reply && <div className="mt-0.5 truncate text-xs opacity-80">模型回复：{test.reply}</div>}
                </>
              ) : (
                <>
                  <div className="font-medium">连接失败</div>
                  <div className="mt-0.5 text-xs">{test.error}</div>
                </>
              )}
            </div>
          )}
          {showForm && !isEdit && test.phase === "idle" && (
            <p className="flex items-center gap-1.5 text-xs text-fg-3">
              <Zap className="size-3.5" /> “测试连接”会先保存这项配置，再发一次很小的请求验证。
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** API Key 输入：永远不回显已保存的 Key；编辑时留空 = 不修改，可标记“清除 Key”。 */
function KeyField({ value, onChange, hasKey, clearKey, onToggleClear, error, hint, optionalHint, required }: {
  value: string;
  onChange: (v: string) => void;
  hasKey: boolean;
  clearKey: boolean;
  onToggleClear: () => void;
  error?: string;
  hint?: string;
  optionalHint?: string;
  required?: boolean;
}) {
  const sub = hasKey
    ? clearKey
      ? "保存时会清除已保存的 Key。"
      : "已保存 Key（不会显示）。留空表示不修改，输入新值会覆盖。"
    : (hint ?? optionalHint ?? "Key 只保存在本机 daemon，不会回显。");
  return (
    <Field label="API Key" htmlFor="prov-key" required={required} error={error} hint={sub}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input
            id="prov-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="pl-10 font-mono text-[13px]"
            value={value}
            disabled={clearKey}
            aria-invalid={!!error || undefined}
            placeholder={hasKey ? "•••••••• 已设置" : "sk-…"}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {hasKey && (
          <Button type="button" size="sm" variant="secondary" icon={<Trash2 className="size-3.5" />} onClick={onToggleClear}>
            {clearKey ? "撤销清除" : "清除 Key"}
          </Button>
        )}
      </div>
    </Field>
  );
}
