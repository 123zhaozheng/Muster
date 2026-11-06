import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { useReducedMotion } from "./motion";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Soft tinted surface + readable text colour per tone (badges, banners, icon tiles). */
const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-2",
  accent: "bg-accent-surface text-accent",
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
};
const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-fg-3",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};
const TONE_OUTLINE: Record<Tone, string> = {
  neutral: "border-border text-fg-2",
  accent: "border-accent/40 text-accent",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/40 text-danger",
};

/* ───────── Button ───────── */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-muted",
  ghost: "text-fg-2 hover:bg-surface-muted hover:text-fg",
  danger: "bg-danger text-white hover:bg-danger/90",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-caption",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-body",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a spinner and blocks clicks while an async action runs. */
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium",
        "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ───────── Card: a flat bordered container ───────── */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface", className)} {...rest} />;
}

/* ───────── Badge ───────── */
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** soft = tinted background, outline = border only. */
  variant?: "soft" | "outline";
  size?: "sm" | "md";
  /** Leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
}
export function Badge({ tone = "neutral", variant = "soft", size = "md", dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "sm" ? "px-2 py-px text-[11px] leading-4" : "px-2.5 py-0.5 text-xs",
        variant === "soft" ? TONE_SOFT[tone] : cn("border bg-surface", TONE_OUTLINE[tone]),
        className,
      )}
      {...rest}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}

interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  /** Above this shows "max+". Default 99. */
  max?: number;
  tone?: Tone;
  showZero?: boolean;
}
/** Pending counter ("需要你", sidebar entries). Renders nothing for 0 unless `showZero`. */
export function CountBadge({ count, max = 99, tone = "warning", showZero, className, ...rest }: CountBadgeProps) {
  if (count <= 0 && !showZero) return null;
  return (
    <span
      className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums", TONE_SOFT[tone], className)}
      {...rest}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

/* ───────── Dot / StatusBadge ───────── */
interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: number;
  /** Soft radiating ring for live states (running / needs you). Off under reduced motion. */
  pulse?: boolean;
}
/** Small round state indicator (always paired with text or an aria-label). */
export function Dot({ tone = "neutral", size = 8, pulse, className, style, ...rest }: DotProps) {
  const ping = usePing(pulse);
  return <span className={cn("inline-block shrink-0 rounded-full", TONE_DOT[tone], ping, className)} style={{ width: size, height: size, ...style }} {...rest} />;
}

function usePing(pulse?: boolean): string | false {
  const reduced = useReducedMotion();
  return !!pulse && !reduced && "relative muster-ping";
}

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Replaces the leading dot (e.g. a lucide icon at size-3.5). */
  icon?: ReactNode;
  /** The leading dot pings (live states such as running). Off under reduced motion. */
  pulse?: boolean;
}
/** Status = small dot + text on a tinted pill. Text always carries the meaning; colour only reinforces it. */
export function StatusBadge({ tone = "neutral", icon, pulse, className, children, ...rest }: StatusBadgeProps) {
  const ping = usePing(pulse);
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", TONE_SOFT[tone], className)} {...rest}>
      {icon ?? <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone], ping)} />}
      {children}
    </span>
  );
}

/* ───────── Segmented ───────── */
interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  className?: string;
}
export function Segmented<T extends string>({ value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div className={cn("inline-flex rounded-control bg-surface-muted p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-3 py-1 text-sm font-medium transition-colors duration-150",
            o.value === value ? "bg-surface text-fg ring-1 ring-border" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
