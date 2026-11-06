import type { ReactNode } from "react";
import type { EventSource } from "@muster/protocol";

/** Source filters + labels shared by the timeline and the trigger editor. */
export const SOURCE_LABEL: Record<EventSource, string> = {
  user: "用户",
  cron: "定时",
  github: "GitHub",
  callback: "回调",
  device: "设备",
  system: "系统",
};

/** Dot colour (solid), card colour (soft), text colour and bar colour per source. */
export const SOURCE_STYLE: Record<EventSource, { dot: string; card: string; text: string; bar: string; ring: string }> = {
  user: { dot: "bg-coral", card: "bg-coral-soft/70", text: "text-coral-deep", bar: "#ff6b4a", ring: "ring-coral/30" },
  cron: { dot: "bg-mint", card: "bg-mint-soft/70", text: "text-mint-deep", bar: "#34c58a", ring: "ring-mint/30" },
  github: { dot: "bg-lavender", card: "bg-lavender-soft/70", text: "text-lavender-deep", bar: "#8b7cf6", ring: "ring-lavender/30" },
  callback: { dot: "bg-amber", card: "bg-amber-soft/70", text: "text-amber-deep", bar: "#f5a524", ring: "ring-amber/30" },
  device: { dot: "bg-sky", card: "bg-sky-soft/70", text: "text-sky-deep", bar: "#5aa9f5", ring: "ring-sky/30" },
  system: { dot: "bg-ink-faint", card: "bg-canvas-deep/80", text: "text-ink-soft", bar: "#a69b92", ring: "ring-ink-faint/30" },
};

const PATHS: Record<EventSource, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  cron: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  github: (
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  ),
  callback: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
};

export function SourceIcon({ source, size = 18, className }: { source: EventSource; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {PATHS[source]}
    </svg>
  );
}
