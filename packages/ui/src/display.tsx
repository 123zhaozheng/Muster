import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import type { Tone } from "./basics";
import { Pebble, type PebbleProps } from "./Pebble";

/* ───────── EmptyState ───────── */
interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** At most one action. */
  action?: ReactNode;
  /** Small avatar. Without `pebble` or `icon` a sleeping Pebble is shown. */
  pebble?: Pick<PebbleProps, "shape" | "color" | "status">;
  /** Line icon (lucide) shown instead of the avatar. */
  icon?: ReactNode;
  /** Avatar size in px, 72 at most. Default 56 (48 when `compact`). */
  size?: number;
  compact?: boolean;
  className?: string;
}
/** Small avatar or line icon + one sentence + at most one action. Use whenever a list or page has no data. */
export function EmptyState({ title, description, action, pebble, icon, size, compact, className }: EmptyStateProps) {
  const px = Math.min(72, size ?? (compact ? 48 : 56));
  return (
    <div className={cn("flex flex-col items-center gap-1.5 px-6 text-center", compact ? "py-8" : "py-14", className)}>
      {icon ? (
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-surface-muted text-fg-2 [&_svg]:size-5">{icon}</div>
      ) : (
        <Pebble shape={pebble?.shape} color={pebble?.color} status={pebble?.status ?? "sleeping"} size={px} className="mb-1" />
      )}
      <div className="text-body font-medium text-fg">{title}</div>
      {description && <div className="max-w-sm text-sm leading-relaxed text-fg-2">{description}</div>}
      {action && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ───────── ProgressBar (flat, static: only for progress that was really reported) ───────── */
const PROGRESS_FILL: Record<Tone, string> = { neutral: "bg-fg-3", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: Tone;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}
export function ProgressBar({ value, max = 100, tone = "accent", label, size = "md", className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      className={cn("w-full overflow-hidden rounded-full bg-border", size === "sm" ? "h-1" : "h-1.5", className)}
    >
      <div className={cn("h-full rounded-full", PROGRESS_FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ───────── Kbd ───────── */
export function Kbd({ className, ...rest }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex min-w-5 items-center justify-center rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] leading-4 text-fg-2", className)}
      {...rest}
    />
  );
}

/* ───────── Skeleton ───────── */
interface SkeletonProps extends ComponentProps<"div"> {
  /** Fully round (avatars). */
  circle?: boolean;
}
/** Static placeholder block. Size it with className (`h-4 w-32`). */
export function Skeleton({ circle, className, ...rest }: SkeletonProps) {
  return <div aria-hidden className={cn("bg-surface-muted", circle ? "rounded-full" : "rounded-control", className)} {...rest} />;
}
