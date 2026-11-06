import { useMemo, useState } from "react";
import { Sparkles, Zap } from "lucide-react";
import type { ModelInfo, ModelProviderConfig, ModelRef, ModelSettings } from "@muster/protocol";
import { Button, Card, Field, Pebble, Select, toast, type SelectOption } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { friendlyTestError, modelDetail, NONE_VALUE, refToValue, valueToRef, withSetting } from "./modelMeta";

type TestState = { phase: "idle" } | { phase: "running" } | { phase: "done"; ok: boolean; latencyMs?: number; reply?: string; error?: string };

/** 按 provider 分组的模型选项；当前选中但已不在列表里的模型也保留一项，避免显示空白。 */
function buildOptions(models: ModelInfo[], providers: ModelProviderConfig[], current: ModelRef | undefined, noneLabel: string): SelectOption[] {
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const opts: SelectOption[] = [{ value: NONE_VALUE, label: noneLabel }];
  for (const m of models) {
    opts.push({ value: refToValue({ provider: m.provider, modelId: m.id }), label: m.name || m.id, description: modelDetail(m) || m.id, group: nameOf(m.provider) });
  }
  if (current && !opts.some((o) => o.value === refToValue(current))) {
    opts.push({ value: refToValue(current), label: current.modelId, description: "当前不可用（服务被停用或删除）", group: nameOf(current.provider) });
  }
  return opts;
}

function ModelRow({ id, label, hint, unsetHint, noneLabel, value, models, providers, onPick }: {
  id: string;
  label: string;
  hint: string;
  unsetHint: string;
  noneLabel: string;
  value?: ModelRef;
  models: ModelInfo[];
  providers: ModelProviderConfig[];
  onPick: (ref: ModelRef | undefined) => Promise<void>;
}) {
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => buildOptions(models, providers, value, noneLabel), [models, providers, value, noneLabel]);

  const pick = async (v: string) => {
    setTest({ phase: "idle" });
    setSaving(true);
    try {
      await onPick(valueToRef(v));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!value) return;
    setTest({ phase: "running" });
    try {
      const r = await hubRequest("model.test", { ref: value });
      setTest({ phase: "done", ok: r.ok, latencyMs: r.latencyMs, reply: r.reply, error: r.ok ? undefined : friendlyTestError(r.error) });
    } catch (e) {
      setTest({ phase: "done", ok: false, error: friendlyTestError(e instanceof Error ? e.message : String(e)) });
    }
  };

  return (
    <div className="grid gap-2">
      <Field label={label} htmlFor={id} hint={value ? hint : undefined}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select id={id} aria-label={label} value={refToValue(value)} onValueChange={pick} options={options} disabled={saving || models.length === 0} placeholder="选择模型" />
          </div>
          <Button variant="outline" icon={<Zap className="size-4" />} loading={test.phase === "running"} disabled={!value} onClick={runTest} aria-label={`测试${label}`}>
            测试
          </Button>
        </div>
      </Field>
      {!value && <p className="text-xs text-amber-deep">{unsetHint}</p>}
      {test.phase === "done" && (
        <div role="status" className={`muster-fade-in rounded-2xl px-3.5 py-2 text-xs ${test.ok ? "bg-mint-soft/70 text-mint-deep" : "bg-danger/10 text-danger-deep"}`}>
          {test.ok ? (
            <>
              <span className="font-medium">可用</span>
              {test.latencyMs != null && <span> · 延迟 {test.latencyMs} ms</span>}
              {test.reply && <span className="block truncate opacity-80">回复：{test.reply}</span>}
            </>
          ) : (
            <>
              <span className="font-medium">不可用</span>
              <span className="block">{test.error}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 顶部“默认模型”卡：Pip 路由模型 + 原生成员默认模型。选择即保存（model.settingsSet）。 */
export function DefaultModelCard({ models, providers, settings, onSettings }: {
  models: ModelInfo[];
  providers: ModelProviderConfig[];
  settings: ModelSettings;
  onSettings: (s: ModelSettings) => void;
}) {
  const save = (key: keyof ModelSettings, name: string) => async (ref: ModelRef | undefined) => {
    try {
      const r = await hubRequest("model.settingsSet", { settings: withSetting(settings, key, ref) });
      onSettings(r.settings);
      toast.success(ref ? `${name}已设为 ${ref.modelId}` : `已清除${name}`);
    } catch (e) {
      toast.error({ title: "保存失败", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Card frosted className="relative overflow-hidden p-6">
      <div aria-hidden className="muster-halo pointer-events-none absolute -right-10 -top-10 size-56 rounded-full" style={{ ["--halo" as string]: "#8b7cf6" }} />
      <div className="relative flex items-start gap-4">
        <Pebble shape="egg" color="lilac" status={settings.router || settings.native ? "idle" : "thinking"} size={64} halo />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
            <Sparkles className="size-4 text-lavender-deep" />
            默认模型
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">选好后立即生效。每个成员也可以在「团队」里单独指定模型。</p>
        </div>
      </div>
      <div className="relative mt-5 grid gap-5 lg:grid-cols-2">
        <ModelRow
          id="model-router"
          label="Pip 路由模型"
          hint="Pip 用它理解你的话、分派任务和闲聊。"
          unsetHint="未设置时 Pip 只能按规则路由（点名成员才会分派），不会闲聊。"
          noneLabel="未设置（仅规则路由）"
          value={settings.router}
          models={models}
          providers={providers}
          onPick={save("router", "Pip 路由模型")}
        />
        <ModelRow
          id="model-native"
          label="原生成员默认模型"
          hint="没有单独指定模型的原生成员都用它。"
          unsetHint="未设置时原生成员无法工作，会提示先去配置模型。"
          noneLabel="未设置"
          value={settings.native}
          models={models}
          providers={providers}
          onPick={save("native", "原生成员默认模型")}
        />
      </div>
      {models.length === 0 && <p className="relative mt-4 rounded-2xl bg-canvas-deep px-4 py-3 text-sm text-ink-soft">还没有可选的模型。先在下方添加一个模型服务，再回来选择。</p>}
    </Card>
  );
}
