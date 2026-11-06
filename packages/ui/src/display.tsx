import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { animate } from "motion/react";
import type { Bot } from "@muster/protocol";
import { cn } from "./cn";
import { EASE, usePrefersReducedMotion } from "./motion";
import { Pebble, STATUS_COLOR, type PebbleProps } from "./Pebble";

/* ───────── AvatarGroup ───────── */
export type AvatarGroupItem = Partial<Pick<Bot, "id" | "name" | "shape" | "color" | "status">>;

export interface AvatarGroupProps {
  bots: AvatarGroupItem[];
  size?: number;
  /** Max avatars shown before collapsing the rest into "+N". */
  max?: number;
  className?: string;
}
/** Overlapping Pebbles, e.g. the bots taking part in a task. (Hover tooltips + spread: see AvatarStack.) */
export function AvatarGroup({ bots, size = 28, max = 4, className }: AvatarGroupProps) {
  const shown = bots.slice(0, max);
  const rest = bots.length - shown.length;
  const ring = "rounded-full bg-surface ring-2 ring-white";
  return (
    <div className={cn("inline-flex items-center", className)} role="group" aria-label={`${bots.length} 位成员`}>
      {shown.map((b, i) => (
        <span key={b.id ?? i} className={cn(ring, "grid place-items-center", i > 0 && "-ml-2")} style={{ width: size, height: size }}>
          <Pebble shape={b.shape} color={b.color} status={b.status} size={Math.round(size * 0.86)} title={b.name} lite />
        </span>
      ))}
      {rest > 0 && (
        <span
          className={cn(ring, "-ml-2 grid place-items-center bg-canvas-deep text-xs font-medium text-ink-soft")}
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/* ───────── ProgressBar ───────── */
type ProgressTone = "coral" | "mint" | "lavender" | "amber" | "sky" | "danger";
const PROGRESS_TONE: Record<ProgressTone, string> = {
  coral: "bg-linear-to-r from-coral-glow to-coral",
  mint: "bg-linear-to-r from-mint/70 to-mint",
  lavender: "bg-linear-to-r from-lavender/70 to-lavender",
  amber: "bg-linear-to-r from-amber/70 to-amber",
  sky: "bg-linear-to-r from-sky/70 to-sky",
  danger: "bg-linear-to-r from-danger/70 to-danger",
};
const PROGRESS_SIZE = { sm: "h-1.5", md: "h-2", lg: "h-3" } as const;
export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
  label?: string;
  className?: string;
  size?: keyof typeof PROGRESS_SIZE;
  /** Moving sheen over the fill. Default: on while 0 < value < max. */
  shine?: boolean;
  /** Unknown duration: a bar sweeping back and forth (no aria-valuenow). */
  indeterminate?: boolean;
}
/** Smoothly animated progress bar (width eases over 500ms) with an optional flowing sheen. */
export function ProgressBar({ value, max = 100, tone = "coral", label, className, size = "md", shine, indeterminate }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const sheen = shine ?? (pct > 0 && pct < 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.min(max, Math.max(0, value))}
      className={cn(
        "w-full overflow-hidden rounded-pill bg-canvas-deep shadow-[inset_0_1px_2px_rgb(60_40_20/0.06)]",
        PROGRESS_SIZE[size],
        indeterminate && "muster-progress-indeterminate",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-pill transition-[width] duration-500 ease-muster",
          PROGRESS_TONE[tone],
          sheen && !indeterminate && "muster-progress-shine",
        )}
        style={{ width: indeterminate ? "40%" : `${pct}%` }}
      />
    </div>
  );
}

/* ───────── Empty (illustrated empty state) ───────── */
export interface EmptyProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  pebble?: Pick<PebbleProps, "shape" | "color" | "status">;
  /** Mascot size in px. Default 112 (72 when `compact`). */
  size?: number;
  compact?: boolean;
  className?: string;
}
/** Big Pebble on a soft halo + title + hint + call to action. Use whenever a list/page has no data yet. */
export function Empty({ title, description, action, pebble, size, compact, className }: EmptyProps) {
  const status = pebble?.status ?? "sleeping";
  const px = size ?? (compact ? 72 : 112);
  return (
    <div className={cn("muster-pop-in relative flex flex-col items-center gap-2 px-6 text-center", compact ? "py-8" : "py-14", className)}>
      <div className="relative grid place-items-center" style={{ width: px * 1.9, height: px * 1.5 }}>
        <span className="muster-halo absolute inset-0 rounded-full" style={{ ["--halo" as string]: STATUS_COLOR[status] === "#a69b92" ? "#ff8a65" : STATUS_COLOR[status] }} />
        <span className="muster-halo absolute -right-2 -top-1 size-1/3 rounded-full" style={{ ["--halo" as string]: "#8b7cf6" }} />
        <Pebble shape={pebble?.shape} color={pebble?.color} status={status} size={px} className="relative" />
      </div>
      <div className={cn("font-semibold text-ink", compact ? "text-base" : "text-[17px]")}>{title}</div>
      {description && <div className="max-w-sm text-sm leading-relaxed text-ink-soft">{description}</div>}
      {action && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  pebble?: Pick<PebbleProps, "shape" | "color" | "status">;
  className?: string;
}
/** v1 name for {@link Empty}. */
export function EmptyState(props: EmptyStateProps) {
  return <Empty {...props} />;
}

/* ───────── Kbd ───────── */
export function Kbd({ className, ...rest }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-md border border-line bg-linear-to-b from-white to-canvas px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink-soft shadow-[0_1px_0_var(--color-line)]",
        className,
      )}
      {...rest}
    />
  );
}

/* ───────── SectionTitle ───────── */
export interface SectionTitleProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Right-aligned slot (buttons, links…). */
  action?: ReactNode;
  className?: string;
}
export function SectionTitle({ title, subtitle, icon, action, className }: SectionTitleProps) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[17px] font-semibold leading-6 text-ink">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ───────── Skeleton ───────── */
export interface SkeletonProps extends ComponentProps<"div"> {
  /** Fully round (avatars). */
  circle?: boolean;
}
/** Shimmering placeholder. Size it with className (`h-4 w-32`). */
export function Skeleton({ circle, className, ...rest }: SkeletonProps) {
  return <div aria-hidden className={cn("muster-skeleton", circle ? "rounded-full" : "rounded-xl", className)} {...rest} />;
}
/** A few skeleton lines, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/* ───────── AnimatedNumber ───────── */
export interface AnimatedNumberProps {
  value: number;
  /** Custom formatter; overrides decimals/prefix/suffix. */
  format?: (n: number) => string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Seconds. Default 0.8. */
  duration?: number;
  /** Count up from 0 on first render. Default false (value changes always roll). */
  animateOnMount?: boolean;
  className?: string;
}
/** Number that rolls to its new value (respects reduced motion). The final value is always in `aria-label` / `data-value`. */
export function AnimatedNumber({ value, format, decimals = 0, prefix = "", suffix = "", duration = 0.8, animateOnMount = false, className }: AnimatedNumberProps) {
  const reduced = usePrefersReducedMotion();
  const fmt = useCallback(
    (n: number) =>
      format
        ? format(n)
        : `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`,
    [format, decimals, prefix, suffix],
  );
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(animateOnMount ? 0 : value);
  const [initial] = useState(() => fmt(shown.current));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || shown.current === value) {
      shown.current = value;
      el.textContent = fmt(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: EASE as unknown as [number, number, number, number],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = fmt(v);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = fmt(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduced, fmt]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)} aria-label={fmt(value)} data-value={value}>
      {initial}
    </span>
  );
}
