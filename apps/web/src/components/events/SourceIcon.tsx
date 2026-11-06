import { Clock, GitPullRequest, Link2, Monitor, Settings2, User, type LucideIcon } from "lucide-react";
import type { EventSource } from "@muster/protocol";

export const SOURCE_LABEL: Record<EventSource, string> = {
  user: "用户",
  cron: "定时",
  github: "GitHub",
  callback: "回调",
  device: "设备",
  system: "系统",
};

const SOURCE_ICON: Record<EventSource, LucideIcon> = {
  user: User,
  cron: Clock,
  github: GitPullRequest,
  callback: Link2,
  device: Monitor,
  system: Settings2,
};

export function SourceIcon({ source, size = 16, className }: { source: EventSource; size?: number; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return <Icon width={size} height={size} aria-hidden className={className} />;
}
