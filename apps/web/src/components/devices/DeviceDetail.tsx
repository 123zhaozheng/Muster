import type { Device } from "@muster/protocol";
import { Card, DescriptionList, StatusBadge } from "@muster/ui";
import { relativeTime } from "../../lib/format";
import { fullTime } from "../events/time";
import { DeviceIcon, OS_LABEL } from "./DeviceRow";
import { RemoteBrowserPanel } from "./RemoteBrowserPanel";

function lastActive(device: Device, now: number): string {
  if (device.isLocal) return "当前正在使用";
  if (device.online) return "现在在线";
  return device.lastSeenAt ? `${relativeTime(device.lastSeenAt, now)}（${fullTime(device.lastSeenAt)}）` : "尚未上线过";
}

export interface DeviceDetailProps {
  device: Device;
  now: number;
  /** Enabled device-online rules that watch this device. */
  ruleCount: number;
}

export function DeviceDetail({ device, now, ruleCount }: DeviceDetailProps) {
  return (
    <div data-testid="device-detail" className="space-y-6 px-5 py-6 md:px-8">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-card bg-surface-muted text-fg-2">
          <DeviceIcon device={device} className="size-7" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-section font-semibold text-fg">{device.name}</h2>
          <div className="mt-1">
            <StatusBadge tone={device.online ? "success" : "neutral"}>{device.online ? "在线" : "离线"}</StatusBadge>
          </div>
        </div>
      </div>

      <Card className="p-5">
        <DescriptionList
          columns={2}
          items={[
            { label: "最后活跃", value: lastActive(device, now) },
            { label: "类型", value: `${OS_LABEL[device.os]} · ${device.isLocal ? "本机" : "已配对设备"}` },
            { label: "设备标识", value: device.id, mono: true, copyable: true, hint: device.isLocal ? "这是正在运行 Muster 的这台电脑" : undefined },
            { label: "上线触发", value: ruleCount > 0 ? `${ruleCount} 条日程在监听这台设备` : "没有日程监听这台设备" },
          ]}
        />
      </Card>

      <RemoteBrowserPanel />
    </div>
  );
}
