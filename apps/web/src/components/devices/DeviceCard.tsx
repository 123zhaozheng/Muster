import { Clock, Laptop, Monitor, Server } from "lucide-react";
import type { Device } from "@muster/protocol";
import { Badge, Card, Chip, Dot, Pulse, cn } from "@muster/ui";
import { relativeTime } from "../events/time";

const OS_LABEL: Record<Device["os"], string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

function DeviceIcon({ device }: { device: Device }) {
  const cloud = !device.isLocal && device.os === "linux" && /云|cloud|server|服务器|vps/i.test(device.name);
  const Icon = cloud ? Server : device.os === "macos" ? Laptop : Monitor;
  return <Icon className="size-7" strokeWidth={1.7} aria-hidden />;
}

export function DeviceCard({ device, now, ruleCount = 0 }: { device: Device; now: number; ruleCount?: number }) {
  const seen = device.lastSeenAt ? relativeTime(device.lastSeenAt, now) : undefined;
  return (
    <Card frosted className={cn("hover-lift relative overflow-hidden p-5", !device.online && "opacity-90")} data-testid="device-card">
      {device.online && <span aria-hidden className="muster-halo pointer-events-none absolute -right-8 -top-8 size-28 rounded-full" style={{ ["--halo" as string]: "#34c58a" }} />}
      <div className="relative flex items-start gap-4">
        <span
          className={cn(
            "grid size-14 shrink-0 place-items-center rounded-2xl border border-white/70 shadow-soft",
            device.online ? "bg-gradient-to-br from-sky-soft to-mint-soft text-sky-deep" : "bg-canvas-deep text-ink-faint",
          )}
        >
          <DeviceIcon device={device} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink">{device.name}</h3>
            {device.isLocal && <Chip tone="coral">本机</Chip>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
            {device.online ? <Pulse tone="mint" size={8} /> : <Dot tone="neutral" size={8} />}
            <span className={device.online ? "font-medium text-mint-deep" : undefined}>{device.online ? "在线" : "离线"}</span>
            <span className="text-ink-faint">· {OS_LABEL[device.os]}</span>
          </div>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        <Badge tone="neutral">{OS_LABEL[device.os]}</Badge>
        {device.isLocal && <Badge tone="coral">本机直连</Badge>}
        {device.online ? <Badge tone="mint" dot>可接收任务</Badge> : <Badge tone="neutral">暂不可用</Badge>}
        {ruleCount > 0 && <Badge tone="lavender">{ruleCount} 条规则监听</Badge>}
      </div>

      <div className="relative mt-4 flex items-center gap-1.5 border-t border-line/80 pt-3 text-xs text-ink-faint">
        <Clock className="size-3.5" aria-hidden />
        {device.isLocal ? "当前正在使用的设备" : seen ? `最后在线 ${seen}` : "尚未上线过"}
      </div>
    </Card>
  );
}
