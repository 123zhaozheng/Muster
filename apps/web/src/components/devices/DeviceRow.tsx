import { Laptop, Monitor, Server } from "lucide-react";
import type { Device } from "@muster/protocol";
import { Dot, cn } from "@muster/ui";

export const OS_LABEL: Record<Device["os"], string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function DeviceIcon({ device, className }: { device: Device; className?: string }) {
  const cloud = !device.isLocal && device.os === "linux" && /云|cloud|server|服务器|vps/i.test(device.name);
  const Icon = cloud ? Server : device.os === "macos" ? Laptop : Monitor;
  return <Icon className={className} strokeWidth={1.7} aria-hidden />;
}

export interface DeviceRowProps {
  device: Device;
  selected: boolean;
  onSelect: () => void;
}

/** One selectable device in the left list. */
export function DeviceRow({ device, selected, onSelect }: DeviceRowProps) {
  return (
    <button
      type="button"
      data-testid="device-row"
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-card px-3 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40",
        selected ? "bg-accent-surface" : "hover:bg-surface-muted",
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-control", device.online ? "bg-surface text-accent" : "bg-surface-muted text-fg-3")}>
        <DeviceIcon device={device} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-fg">{device.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-caption text-fg-2">
          <Dot tone={device.online ? "success" : "neutral"} size={8} />
          {device.online ? "在线" : "离线"}
          {device.isLocal && <span className="text-fg-3">· 本机</span>}
        </span>
      </span>
    </button>
  );
}
