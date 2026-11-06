import { useEffect, useState, type ReactNode } from "react";
import { Moon, ShieldCheck, Sun } from "lucide-react";
import { Badge, Card, Chip, Divider, Kbd, Pebble, Section, Segmented, Switch, UiGallery, cn } from "@muster/ui";
import { useHub } from "../../lib/hub";

const DEFAULT_DAEMON = "ws://127.0.0.1:7788/ws";
export const APPROVAL_LEVEL_KEY = "muster.approvalLevel";
export type ApprovalLevel = "careful" | "balanced" | "relaxed";

const STATUS_TEXT = { open: ["已连接", "mint"], connecting: ["连接中", "amber"], closed: ["已断开", "danger"] } as const;

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line/70 py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-sm">{children}</div>
    </div>
  );
}

/** 当前连接的 daemon 地址（与 startHub 的取值规则一致）。 */
function daemonUrl(): string {
  const q = new URLSearchParams(window.location.search + "&" + (window.location.hash.split("?")[1] ?? ""));
  return q.get("daemon") ?? DEFAULT_DAEMON;
}

export function GeneralSection() {
  const status = useHub((s) => s.status);
  const mock = useHub((s) => s.mock);
  const [label, tone] = STATUS_TEXT[status];

  const toggleMock = () => {
    if (mock) {
      localStorage.removeItem("muster.mock");
      // URL 里的 ?mock=1 会强制进入演示模式，一并清掉。
      const url = new URL(window.location.href);
      if (url.searchParams.has("mock")) {
        url.searchParams.delete("mock");
        window.history.replaceState(null, "", url);
      }
    } else {
      localStorage.setItem("muster.mock", "1");
    }
    window.location.reload();
  };

  return (
    <div className="grid gap-8">
      <Section title="通用" description="连接与运行方式。" card>
        <Row label="守护进程地址" hint="Muster 的后台服务，所有成员都跑在它里面。">
          <span className="truncate rounded-xl bg-canvas-deep px-3 py-1.5 font-mono text-xs">{mock ? "演示模式（内置样例数据）" : daemonUrl()}</span>
        </Row>
        <Row label="连接状态">
          <Chip tone={tone}>{label}</Chip>
        </Row>
        <Row label="演示模式" hint="使用内置样例数据，不连接 daemon；切换后会刷新页面。">
          <Switch aria-label="演示模式" checked={mock} onCheckedChange={toggleMock} />
        </Row>
      </Section>
      <Section title="快捷键" description="常用操作都有快捷键。" card>
        <Row label="命令面板"><span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span></Row>
        <Row label="收起 / 展开侧栏"><span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>B</Kbd></span></Row>
        <p className="pt-3 text-xs text-ink-faint">macOS 上用 ⌘ 代替 Ctrl。</p>
      </Section>
    </div>
  );
}

const LEVELS: Array<{ value: ApprovalLevel; label: string; hint: string }> = [
  { value: "careful", label: "谨慎", hint: "几乎每一步写入和命令都问你。" },
  { value: "balanced", label: "均衡", hint: "读取自动放行，写入与命令请你确认。" },
  { value: "relaxed", label: "宽松", hint: "低风险操作自动放行，高风险仍会问你。" },
];

export function SafetySection() {
  const [level, setLevel] = useState<ApprovalLevel>(() => {
    const v = localStorage.getItem(APPROVAL_LEVEL_KEY);
    return v === "careful" || v === "relaxed" ? v : "balanced";
  });
  useEffect(() => localStorage.setItem(APPROVAL_LEVEL_KEY, level), [level]);
  const current = LEVELS.find((l) => l.value === level)!;

  return (
    <Section title="审批与安全" description="决定成员干活时哪些事要先问你。" actions={<Chip tone="lavender">下个版本生效</Chip>}>
      <div className="grid gap-5">
        <Card className="p-5">
          <Row label="审批档位" hint={current.hint}>
            <Segmented<ApprovalLevel> value={level} onChange={setLevel} options={LEVELS.map(({ value, label }) => ({ value, label }))} />
          </Row>
          <p className="mt-3 text-xs text-ink-soft">档位目前只保存在本机浏览器，暂不影响实际审批；所有操作仍按默认规则请你确认。</p>
        </Card>
        <Card className="flex items-start gap-3 bg-canvas-deep/70 p-5 shadow-none">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-mint-deep" />
          <div>
            <div className="text-sm font-medium text-ink">无人值守时更保守</div>
            <p className="mt-1 text-sm text-ink-soft">
              无人值守（定时、GitHub、设备上线等触发）时产生的审批会自动拒绝，不会等你，也不会悄悄放行。可在事件页的触发规则里按规则调整。
            </p>
          </div>
        </Card>
      </div>
    </Section>
  );
}

export function AppearanceSection() {
  return (
    <Section title="外观" description="主题与显示。">
      <div className="grid max-w-xl grid-cols-2 gap-4">
        <button
          type="button"
          aria-pressed
          className="group cursor-pointer rounded-card border-2 border-coral bg-surface p-3 text-left shadow-pop transition-transform hover:-translate-y-0.5"
        >
          <div className="mb-3 flex h-20 items-end gap-1.5 overflow-hidden rounded-2xl bg-canvas p-2.5">
            <span className="h-full w-6 rounded-lg bg-canvas-deep" />
            <span className="flex-1 space-y-1.5 pb-1"><span className="block h-2 w-2/3 rounded-full bg-line" /><span className="block h-6 rounded-lg bg-surface shadow-soft" /></span>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><Sun className="size-4 text-coral" />浅色</div>
        </button>
        <button type="button" disabled title="即将推出" className="cursor-not-allowed rounded-card border-2 border-line bg-surface p-3 text-left opacity-60">
          <div className="mb-3 flex h-20 items-end gap-1.5 overflow-hidden rounded-2xl bg-ink p-2.5">
            <span className="h-full w-6 rounded-lg bg-white/10" />
            <span className="flex-1 space-y-1.5 pb-1"><span className="block h-2 w-2/3 rounded-full bg-white/20" /><span className="block h-6 rounded-lg bg-white/10" /></span>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><Moon className="size-4" />深色 <Badge size="sm" tone="lavender">即将推出</Badge></div>
        </button>
      </div>
      <p className="mt-4 text-xs text-ink-faint">动画会跟随系统的“减少动态效果”设置。</p>
    </Section>
  );
}

export function AboutSection() {
  return (
    <Section title="关于" card>
      <div className="flex items-center gap-5">
        <Pebble shape="round" color="peach" status="idle" size={72} halo />
        <div className="min-w-0">
          <div className="text-xl font-semibold text-ink">Muster</div>
          <div className="text-sm text-ink-soft">个人 Agent 指挥台</div>
        </div>
      </div>
      <Divider className="my-5" />
      <Row label="版本"><span className="font-mono text-sm">0.0.1</span></Row>
      <Row label="开源许可">
        <span className="max-w-md text-right text-xs text-ink-soft">Muster 计划以开源方式发布，具体许可证将在首个公开版本确认。</span>
      </Row>
    </Section>
  );
}

/** 组件展示：设计系统里所有组件的预览，供开发与设计校对。 */
export function GallerySection({ className }: { className?: string }) {
  return (
    <Section title="组件展示" description="设计系统里所有组件的预览，供开发与设计校对。" className={cn(className)}>
      <Card className="overflow-hidden p-5">
        <UiGallery />
      </Card>
    </Section>
  );
}
