import { Eye, Hand, Lock, MousePointer2, Pause, ShieldCheck, Square, Sparkles } from "lucide-react";
import { Badge, Button, Card, Pebble, Skeleton } from "@muster/ui";

const FEATURES = [
  { icon: <Eye />, title: "实时画面", text: "看着小探一步步操作网页" },
  { icon: <Hand />, title: "随时接管", text: "一键拿回鼠标和键盘" },
  { icon: <ShieldCheck />, title: "敏感操作需确认", text: "支付、提交前先问你" },
  { icon: <Lock />, title: "仅在你的设备", text: "浏览器跑在你自己的电脑上" },
];

/** "Coming soon" preview of the remote browser. A static illustration only — no fake running data. */
export function RemoteBrowserPanel() {
  return (
    <Card frosted className="relative overflow-hidden p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-sky-soft text-sky-deep [&_svg]:size-[18px]">
            <MousePointer2 />
          </span>
          <div>
            <h3 className="text-[17px] font-semibold leading-6 text-ink">远程浏览器</h3>
            <p className="text-xs text-ink-faint">让成员替你操作网页，你随时可以接管</p>
          </div>
        </div>
        <Badge tone="lavender" icon={<Sparkles className="size-3" />}>即将推出</Badge>
      </div>

      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-soft">
          <div className="flex items-center gap-3 border-b border-line bg-canvas px-3.5 py-2.5">
            <div className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-danger/70" />
              <span className="size-2.5 rounded-full bg-amber/80" />
              <span className="size-2.5 rounded-full bg-mint/80" />
            </div>
            <div aria-label="地址栏" className="flex h-8 flex-1 items-center gap-2 rounded-pill bg-surface px-4 text-sm text-ink-faint shadow-[inset_0_1px_2px_rgb(60_40_20/0.05)]">
              <Lock className="size-3.5" aria-hidden />
              about:blank
            </div>
          </div>
          <div className="relative grid min-h-[300px] place-items-center overflow-hidden bg-gradient-to-b from-lavender-soft/60 via-surface to-coral-soft/50 p-8">
            <div className="absolute inset-x-8 top-6 space-y-2.5 opacity-70" aria-hidden>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="relative flex flex-col items-center gap-4 text-center">
              <Pebble shape="egg" color="sky" status="sleeping" size={112} halo title="小探在睡觉" />
              <p className="max-w-sm text-sm leading-relaxed text-ink-soft">远程浏览器即将推出：让小探在你的电脑上操作网页，你可随时接管</p>
              <span className="inline-flex items-center gap-2 rounded-pill bg-surface/90 px-3.5 py-1.5 text-xs text-ink-soft shadow-soft">
                <Pebble shape="egg" color="sky" status="idle" size={20} lite />
                小探待命中 · 暂无进行中的会话
              </span>
            </div>
          </div>
        </div>

        <ul className="grid content-start gap-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3 rounded-2xl border border-line bg-surface/70 p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral-soft text-coral-deep [&_svg]:size-[18px]">{f.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{f.title}</div>
                <div className="text-xs leading-relaxed text-ink-soft">{f.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex justify-center gap-3">
        <Button variant="primary" size="lg" icon={<Hand className="size-4" />} disabled>接管</Button>
        <Button size="lg" icon={<Pause className="size-4" />} disabled>暂停</Button>
        <Button size="lg" icon={<Square className="size-4" />} disabled>结束</Button>
      </div>
    </Card>
  );
}
