import { useMemo, useState, type ReactNode } from "react";
import { Trash2, Play } from "lucide-react";
import type { Bot, Device, TriggerMode, TriggerRule } from "@muster/protocol";
import { Button, ConfirmDialog, Field, Input, Pebble, Segmented, Select, Sheet, SheetClose, SheetContent, Slider, Switch, cn, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { fireTrigger } from "./actions";
import { CRON_PRESETS, TIMEZONES, checkCron, formatFireTime } from "./cron";
import { GITHUB_EVENTS, MODE_LABEL, MODE_META } from "./meta";
import { SOURCE_STYLE, SourceIcon } from "./SourceIcon";

type RuleSource = TriggerRule["source"];

const SOURCE_OPTIONS: { value: RuleSource; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "cron", label: "定时" },
  { value: "device", label: "设备上线" },
];

interface Draft {
  label: string;
  source: RuleSource;
  repo: string;
  event: string;
  expr: string;
  tz: string;
  deviceId: string;
  targetBotId: string;
  mode: TriggerMode;
  dailyBudget: number;
  autoDeny: boolean;
}

function draftOf(rule: TriggerRule | undefined, bots: Bot[], devices: Device[]): Draft {
  const p = rule?.params ?? {};
  return {
    label: rule?.label ?? "",
    source: rule?.source ?? "github",
    repo: p.repo ?? "",
    event: p.event ?? "pull_request.opened",
    expr: p.expr ?? "0 9 * * *",
    tz: p.tz ?? "Asia/Shanghai",
    deviceId: p.deviceId ?? devices.find((d) => !d.isLocal)?.id ?? devices[0]?.id ?? "",
    targetBotId: rule?.targetBotId ?? bots.find((b) => b.kind !== "main")?.id ?? bots[0]?.id ?? "",
    mode: rule?.mode ?? "observe",
    dailyBudget: rule?.dailyBudget ?? 10,
    autoDeny: rule?.autoDenyApprovalsWhenUnattended ?? true,
  };
}

function paramsOf(d: Draft): Record<string, string> {
  if (d.source === "github") return { repo: d.repo.trim(), event: d.event };
  if (d.source === "cron") return { expr: d.expr.trim(), tz: d.tz.trim() };
  if (d.source === "device") return { deviceId: d.deviceId };
  return {};
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

interface FormProps {
  rule?: TriggerRule;
  bots: Bot[];
  devices: Device[];
  onSaved?: (t: TriggerRule) => void;
  onDeleted?: () => void;
  onClose: () => void;
}

function TriggerForm({ rule, bots, devices, onSaved, onDeleted, onClose }: FormProps) {
  const [d, setD] = useState<Draft>(() => draftOf(rule, bots, devices));
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const target = bots.find((b) => b.id === d.targetBotId);
  const style = SOURCE_STYLE[d.source];
  const cron = useMemo(() => (d.source === "cron" ? checkCron(d.expr, d.tz) : null), [d.source, d.expr, d.tz]);

  const errors = {
    label: d.label.trim() ? undefined : "给规则起个名字吧",
    repo: d.source === "github" && !d.repo.trim() ? "请填写要监听的仓库" : undefined,
    expr: cron && !cron.ok ? cron.error : undefined,
    device: d.source === "device" && !d.deviceId ? "请选择设备" : undefined,
    bot: d.targetBotId ? undefined : "请选择要交给哪位成员",
  };
  const hasError = Object.values(errors).some(Boolean);
  const shown = <K extends keyof typeof errors>(k: K) => (showErrors ? errors[k] : undefined);

  const botOptions = bots.map((b) => ({
    value: b.id,
    label: b.name,
    description: b.engineLabel,
    icon: <Pebble shape={b.shape} color={b.color} status="idle" size={20} lite />,
  }));
  const githubEvents = GITHUB_EVENTS.some((e) => e.value === d.event) ? GITHUB_EVENTS : [...GITHUB_EVENTS, { value: d.event, label: d.event, description: "自定义事件类型" }];
  const tzOptions = (TIMEZONES.includes(d.tz) || !d.tz ? TIMEZONES : [d.tz, ...TIMEZONES]).map((z) => ({ value: z, label: z }));

  async function save() {
    setShowErrors(true);
    if (hasError) return;
    setBusy(true);
    setSaveError(null);
    try {
      // Spread the live rule so fields not on the form (enabled, lastFiredAt) are preserved.
      const { trigger } = await hubRequest("trigger.upsert", {
        trigger: {
          ...rule,
          label: d.label.trim(),
          source: d.source,
          params: paramsOf(d),
          targetBotId: d.targetBotId,
          mode: d.mode,
          enabled: rule?.enabled ?? true,
          dailyBudget: d.dailyBudget,
          autoDenyApprovalsWhenUnattended: d.autoDeny,
        },
      });
      toast.success(rule ? "规则已保存" : "规则已创建", { description: trigger.label });
      onSaved?.(trigger);
      onClose();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setSaveError(text);
      toast.error("保存失败", { description: text });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule) return;
    try {
      await hubRequest("trigger.delete", { triggerId: rule.id });
    } catch (e) {
      toast.error("删除失败", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    toast.success("规则已删除", { description: rule.label });
    onDeleted?.();
    onClose();
  }

  const footer = (
    <div className="flex w-full items-center gap-2">
      {rule && (
        <>
          <ConfirmDialog
            tone="danger"
            title="删除这条触发规则？"
            description={`「${rule.label}」删除后不会再触发，已产生的事件记录仍会保留。`}
            confirmText="确认删除"
            onConfirm={remove}
            trigger={
              <Button variant="ghost" className="text-danger hover:text-danger-deep" icon={<Trash2 className="size-4" />}>
                删除
              </Button>
            }
          />
          <Button variant="soft" icon={<Play className="size-4" />} disabled={busy} onClick={() => void fireTrigger(rule)}>
            试跑
          </Button>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <SheetClose asChild>
          <Button variant="ghost" disabled={busy}>取消</Button>
        </SheetClose>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <SheetContent
      width={520}
      title={rule ? "编辑规则" : "新建规则"}
      description="当来源满足条件时，把事件交给指定成员处理"
      footer={footer}
    >
      <div className="space-y-7">
        <div className={cn("relative flex items-center gap-3 overflow-hidden rounded-card border border-white/70 p-4 pr-3 shadow-soft", style.card)}>
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl text-white shadow-soft", style.dot)}>
            <SourceIcon source={d.source} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-ink">{d.label.trim() || "未命名规则"}</div>
            <div className="truncate text-xs text-ink-soft">
              交给 {target?.name ?? "—"} · {MODE_LABEL[d.mode]}模式 · 每日最多 {d.dailyBudget} 次
            </div>
          </div>
          {target && <Pebble shape={target.shape} color={target.color} status="idle" size={56} halo title={target.name} />}
        </div>

        <Group title="触发条件">
          <Field label="名称" htmlFor="tr-label" required error={shown("label")}>
            <Input id="tr-label" placeholder="例如：每周一复盘" value={d.label} aria-invalid={!!shown("label") || undefined} onChange={(e) => set("label", e.target.value)} />
          </Field>

          <Field label="来源">
            <Segmented value={d.source} onChange={(v) => set("source", v)} options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: <SourceIcon source={o.value} size={15} /> }))} />
          </Field>

          {d.source === "github" && (
            <>
              <Field label="仓库" htmlFor="tr-repo" required error={shown("repo")} hint="owner/repo，或者仅仓库名">
                <Input id="tr-repo" placeholder="owner/repo" value={d.repo} aria-invalid={!!shown("repo") || undefined} onChange={(e) => set("repo", e.target.value)} />
              </Field>
              <Field label="事件类型" htmlFor="tr-event">
                <Select id="tr-event" value={d.event} onValueChange={(v) => set("event", v)} options={githubEvents} />
              </Field>
            </>
          )}

          {d.source === "cron" && (
            <>
              <div className="space-y-2">
                <div className="text-sm font-medium text-ink">常用频率</div>
                <div className="flex flex-wrap gap-2">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.expr}
                      type="button"
                      aria-pressed={d.expr.trim() === p.expr}
                      onClick={() => set("expr", p.expr)}
                      className={cn(
                        "cursor-pointer rounded-pill border px-3 py-1 text-xs font-medium transition-[background-color,color,border-color,transform] duration-200 active:scale-95",
                        d.expr.trim() === p.expr ? "border-coral bg-coral-soft text-coral-deep" : "border-line bg-surface text-ink-soft hover:border-ink-faint/50 hover:text-ink",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
                <Field label="Cron 表达式" htmlFor="tr-expr" required error={shown("expr")} hint="分 时 日 月 周，例如 0 9 * * 1-5">
                  <Input id="tr-expr" className="font-mono" placeholder="0 9 * * *" value={d.expr} aria-invalid={!!shown("expr") || undefined} onChange={(e) => set("expr", e.target.value)} />
                </Field>
                <Field label="时区" htmlFor="tr-tz">
                  <Select id="tr-tz" value={d.tz} onValueChange={(v) => set("tz", v)} options={tzOptions} />
                </Field>
              </div>
              <div className="rounded-2xl bg-canvas-deep/70 p-3.5" aria-live="polite" data-testid="cron-preview">
                <div className="mb-2 text-xs font-medium text-ink-faint">下次运行时间</div>
                {cron?.ok ? (
                  <ol className="space-y-1">
                    {cron.next.map((n, i) => (
                      <li key={n.getTime()} className="flex items-center gap-2 text-sm text-ink">
                        <span className={cn("size-1.5 rounded-full", i === 0 ? "bg-coral" : "bg-ink-faint/50")} />
                        <span className={cn("tabular-nums", i === 0 && "font-medium")}>{formatFireTime(n, d.tz)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-sm text-ink-faint">表达式有效后，这里会显示接下来的运行时间</div>
                )}
              </div>
            </>
          )}

          {d.source === "device" && (
            <Field label="设备" htmlFor="tr-device" required error={shown("device")} hint="选中的设备上线时触发">
              <Select id="tr-device" value={d.deviceId} onValueChange={(v) => set("deviceId", v)} placeholder="选择设备" options={devices.map((dev) => ({ value: dev.id, label: dev.name }))} />
            </Field>
          )}
        </Group>

        <Group title="处理方式">
          <Field label="交给" htmlFor="tr-bot" required error={shown("bot")}>
            <Select id="tr-bot" value={d.targetBotId} onValueChange={(v) => set("targetBotId", v)} placeholder="选择成员" options={botOptions} />
          </Field>

          <div className="space-y-2">
            <div className="text-sm font-medium text-ink" id="tr-mode-label">模式</div>
            <div role="radiogroup" aria-labelledby="tr-mode-label" className="grid grid-cols-3 gap-2.5">
              {(Object.keys(MODE_LABEL) as TriggerMode[]).map((m) => {
                const meta = MODE_META[m];
                const on = d.mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={MODE_LABEL[m]}
                    onClick={() => set("mode", m)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-3 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 focus-visible:ring-4 focus-visible:ring-coral/20 active:scale-[0.98]",
                      on ? "border-coral bg-coral-soft/70 shadow-glow-coral" : "border-line bg-surface hover:-translate-y-px hover:border-ink-faint/50 hover:shadow-soft",
                    )}
                  >
                    <span className={cn("grid size-7 place-items-center rounded-lg [&_svg]:size-4", on ? "bg-coral text-white" : "bg-canvas-deep text-ink-soft")}>{meta.icon}</span>
                    <span className="text-sm font-semibold text-ink" aria-hidden>{MODE_LABEL[m]}</span>
                    <span className="text-xs leading-snug text-ink-faint" aria-hidden>{meta.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="rounded-xl bg-canvas-deep/70 px-3 py-2 text-xs leading-relaxed text-ink-soft" data-testid="mode-detail">
              {MODE_META[d.mode].detail}
            </p>
          </div>
        </Group>

        <Group title="安全与预算">
          <Field label="每日预算" htmlFor="tr-budget" hint="每天最多触发的次数，超出后当天不再执行">
            <div className="flex items-center gap-3">
              <Slider id="tr-budget" min={1} max={50} value={d.dailyBudget} onValueChange={(v) => set("dailyBudget", v)} className="min-w-0 flex-1" />
              <span className="w-16 shrink-0 rounded-pill border border-line bg-surface py-1.5 text-center text-sm tabular-nums">{d.dailyBudget} 次</span>
            </div>
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-3.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">无人值守时自动拒绝审批</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-faint">无人值守触发的任务若需要审批，会直接拒绝，不会等你。</div>
            </div>
            <Switch checked={d.autoDeny} onCheckedChange={(v) => set("autoDeny", v)} aria-label="无人值守时自动拒绝审批" />
          </div>
        </Group>

        {saveError && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-deep">{saveError}</p>}
      </div>
    </SheetContent>
  );
}

export interface TriggerSheetProps extends Omit<FormProps, "onClose"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create / edit a trigger rule in a right-hand drawer. Mount with a `key` that changes per opening so the draft resets. */
export function TriggerSheet({ open, onOpenChange, ...form }: TriggerSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <TriggerForm {...form} onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}
