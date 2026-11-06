import { useMemo, useState, type ReactNode } from "react";
import { Trash2, Play } from "lucide-react";
import type { Bot, Device, TriggerMode, TriggerRule } from "@muster/protocol";
import { Button, ConfirmDialog, Field, Input, Segmented, Select, Drawer, DrawerClose, DrawerContent, Slider, Switch, cn, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { MemberAvatar } from "../common";
import { fireTrigger } from "./actions";
import { CRON_PRESETS, TIMEZONES, checkCron, formatFireAt } from "./cron";
import { GITHUB_EVENTS, MODE_LABEL, MODE_META } from "./meta";
import { SourceIcon } from "./SourceIcon";

type RuleSource = TriggerRule["source"];

const SOURCE_OPTIONS: { value: RuleSource; label: string }[] = [
  { value: "cron", label: "定时" },
  { value: "github", label: "GitHub" },
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
    source: rule?.source ?? "cron",
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
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
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
  const cron = useMemo(() => (d.source === "cron" ? checkCron(d.expr, d.tz) : null), [d.source, d.expr, d.tz]);

  const errors = {
    label: d.label.trim() ? undefined : "给日程起个名字吧",
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
    icon: <MemberAvatar bot={{ ...b, status: "idle" }} size={20} />,
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
      toast.success(rule ? "日程已保存" : "日程已创建", { description: trigger.label });
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
    toast.success("日程已删除", { description: rule.label });
    onDeleted?.();
    onClose();
  }

  const footer = (
    <div className="flex w-full items-center gap-2">
      {rule && (
        <>
          <ConfirmDialog
            tone="danger"
            title="删除这条日程？"
            description={`「${rule.label}」删除后不会再触发，已产生的事件记录仍会保留。`}
            confirmText="确认删除"
            onConfirm={remove}
            trigger={
              <Button variant="ghost" className="text-danger hover:text-danger" icon={<Trash2 className="size-4" />}>
                删除
              </Button>
            }
          />
          <Button variant="secondary" icon={<Play className="size-4" />} disabled={busy} onClick={() => void fireTrigger(rule)}>
            试跑
          </Button>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <DrawerClose asChild>
          <Button variant="ghost" disabled={busy}>取消</Button>
        </DrawerClose>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <DrawerContent width={520} title={rule ? "编辑日程" : "新建日程"} description="满足条件时，把事件交给指定成员处理" footer={footer}>
      <div className="space-y-7">
        <Group title="什么时候触发">
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
                <div className="text-sm font-medium text-fg">常用频率</div>
                <div className="flex flex-wrap gap-2">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.expr}
                      type="button"
                      aria-pressed={d.expr.trim() === p.expr}
                      onClick={() => set("expr", p.expr)}
                      className={cn(
                        "h-8 cursor-pointer rounded-control border px-3 text-caption font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40",
                        d.expr.trim() === p.expr ? "border-accent bg-accent-surface text-accent" : "border-border bg-surface text-fg-2 hover:bg-surface-muted hover:text-fg",
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
              <div className="rounded-control bg-surface-muted p-3.5" aria-live="polite" data-testid="cron-preview">
                <div className="mb-2 text-xs font-medium text-fg-3">接下来的运行时间{d.tz && `（${d.tz}）`}</div>
                {cron?.ok ? (
                  <ol className="space-y-1">
                    {cron.next.map((n, i) => (
                      <li key={n.getTime()} className={cn("text-sm tabular-nums text-fg", i === 0 && "font-medium")}>
                        {formatFireAt(n, d.tz)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-sm text-fg-3">表达式有效后，这里会显示接下来的运行时间</div>
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

        <Group title="谁来处理">
          <Field label="交给" htmlFor="tr-bot" required error={shown("bot")}>
            <Select id="tr-bot" value={d.targetBotId} onValueChange={(v) => set("targetBotId", v)} placeholder="选择成员" options={botOptions} />
          </Field>

          <Field label="模式">
            <div className="space-y-2">
              <Segmented
                value={d.mode}
                onChange={(v) => set("mode", v)}
                options={(Object.keys(MODE_LABEL) as TriggerMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], icon: <span className="[&_svg]:size-3.5">{MODE_META[m].icon}</span> }))}
              />
              <p className="text-sm text-fg-2" data-testid="mode-detail">
                {MODE_META[d.mode].detail}
              </p>
            </div>
          </Field>
        </Group>

        <Group title="安全与预算">
          <Field label="每日预算" htmlFor="tr-budget" hint="每天最多触发的次数，超出后当天不再执行">
            <div className="flex items-center gap-3">
              <Slider id="tr-budget" min={1} max={50} value={d.dailyBudget} onValueChange={(v) => set("dailyBudget", v)} className="min-w-0 flex-1" />
              <span className="w-14 shrink-0 text-right text-sm tabular-nums text-fg">{d.dailyBudget} 次</span>
            </div>
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">无人值守时自动拒绝审批</div>
              <div className="mt-0.5 text-caption text-fg-2">无人值守触发的任务若需要审批，会直接拒绝，不会等你。</div>
            </div>
            <Switch checked={d.autoDeny} onCheckedChange={(v) => set("autoDeny", v)} aria-label="无人值守时自动拒绝审批" />
          </div>
        </Group>

        {saveError && <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">{saveError}</p>}
      </div>
    </DrawerContent>
  );
}

export interface TriggerSheetProps extends Omit<FormProps, "onClose"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create / edit a schedule rule in a right-hand drawer. Mount with a `key` that changes per opening so the draft resets. */
export function TriggerSheet({ open, onOpenChange, ...form }: TriggerSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <TriggerForm {...form} onClose={() => onOpenChange(false)} />
    </Drawer>
  );
}
