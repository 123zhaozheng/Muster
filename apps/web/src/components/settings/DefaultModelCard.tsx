import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import type { ModelInfo, ModelProviderConfig, ModelRef, ModelSettings } from "@muster/protocol";
import { Button, Section, SettingsRow, Select, cn, type SelectOption } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { friendlyTestError, modelDetail, NONE_VALUE, refToValue, valueToRef, withSetting } from "./modelMeta";

type TestState = { phase: "idle" } | { phase: "running" } | { phase: "done"; ok: boolean; latencyMs?: number; reply?: string; error?: string };
type SaveState = "idle" | "saving" | "saved" | "failed";

const SAVE_TEXT: Record<Exclude<SaveState, "idle">, string> = { saving: "保存中…", saved: "已保存", failed: "保存失败，已恢复" };

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
  /** 保存成功返回 true；失败返回 false（界面保持原值）。 */
  onPick: (ref: ModelRef | undefined) => Promise<boolean>;
}) {
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [save, setSave] = useState<SaveState>("idle");
  const options = useMemo(() => buildOptions(models, providers, value, noneLabel), [models, providers, value, noneLabel]);

  const pick = async (v: string) => {
    setTest({ phase: "idle" });
    setSave("saving");
    setSave((await onPick(valueToRef(v))) ? "saved" : "failed");
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
    <div className="border-b border-border py-3.5 first:pt-0 last:border-b-0 last:pb-0">
      <SettingsRow label={label} description={value ? hint : unsetHint} className="!border-0 !p-0">
        <div className="flex items-center gap-2">
          {save !== "idle" && (
            <span role="status" className={cn("text-xs", save === "failed" ? "text-danger" : "text-fg-3")}>{SAVE_TEXT[save]}</span>
          )}
          <div className="w-64">
            <Select id={id} aria-label={label} value={refToValue(value)} onValueChange={pick} options={options} disabled={save === "saving" || models.length === 0} placeholder="选择模型" />
          </div>
          <Button variant="secondary" icon={<Zap className="size-4" />} loading={test.phase === "running"} disabled={!value} onClick={runTest} aria-label={`测试${label}`}>
            测试
          </Button>
        </div>
      </SettingsRow>
      {test.phase === "done" && (
        <div role="status" className={cn("muster-fade-in mt-3 rounded-control px-3 py-2 text-xs", test.ok ? "bg-success-surface text-success" : "bg-danger-surface text-danger")}>
          {test.ok ? (
            <>
              <span className="font-medium">可用</span>
              {test.latencyMs != null && <span> · 延迟 {test.latencyMs} ms</span>}
              {test.reply && <span className="block truncate">回复：{test.reply}</span>}
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

/** “默认模型”：Pip 路由模型 + 原生成员默认模型。选择即保存（model.settingsSet）。 */
export function DefaultModelCard({ models, providers, settings, onSettings }: {
  models: ModelInfo[];
  providers: ModelProviderConfig[];
  settings: ModelSettings;
  onSettings: (s: ModelSettings) => void;
}) {
  const save = (key: keyof ModelSettings) => async (ref: ModelRef | undefined): Promise<boolean> => {
    try {
      const r = await hubRequest("model.settingsSet", { settings: withSetting(settings, key, ref) });
      onSettings(r.settings);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <Section title="默认模型" description="选好后立即生效。每个成员也可以在「团队」里单独指定模型。" card>
      <ModelRow
        id="model-router"
        label="Pip 路由模型"
        hint="Pip 用它理解你的话、分派任务和闲聊。"
        unsetHint="未设置时 Pip 只能按规则路由（点名成员才会分派），不会闲聊。"
        noneLabel="未设置（仅规则路由）"
        value={settings.router}
        models={models}
        providers={providers}
        onPick={save("router")}
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
        onPick={save("native")}
      />
      {models.length === 0 && <p className="mt-4 rounded-control bg-surface-muted px-4 py-3 text-sm text-fg-2">还没有可选的模型。先在下方添加一个模型服务，再回来选择。</p>}
    </Section>
  );
}
