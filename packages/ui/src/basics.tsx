import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { BotStatus } from "@muster/protocol";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { STATUS_COLOR, STATUS_LABEL } from "./Pebble";

type ButtonVariant = "primary" | "soft" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "muster-gradient-brand text-white shadow-glow-coral hover:brightness-105 hover:-translate-y-px active:translate-y-0",
  soft: "bg-coral-soft text-coral-deep hover:bg-coral-soft/70 hover:-translate-y-px active:translate-y-0",
  outline: "border border-line bg-surface text-ink shadow-soft hover:bg-canvas-deep hover:border-ink-faint/40 hover:-translate-y-px active:translate-y-0",
  ghost: "text-ink-soft hover:bg-canvas-deep hover:text-ink",
  danger: "bg-danger text-white shadow-soft hover:bg-danger-deep hover:-translate-y-px active:translate-y-0",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a spinner and blocks clicks while an async action runs. */
  loading?: boolean;
}

export function Button({ variant = "outline", size = "md", icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-pill font-medium",
        "transition-[transform,box-shadow,background-color,filter,border-color,color] duration-200 ease-muster active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="muster-spin size-4 shrink-0" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Frosted-glass surface instead of solid white. */
  frosted?: boolean;
  /** Lift 2px and deepen the shadow on hover (use for clickable cards). */
  hoverable?: boolean;
}
export function Card({ frosted, hoverable, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card shadow-card",
        frosted ? "muster-frost" : "bg-surface border border-line",
        hoverable && "hover-lift cursor-pointer",
        className,
      )}
      {...rest}
    />
  );
}

export type ChipTone = "neutral" | "coral" | "lavender" | "mint" | "amber" | "sky" | "danger";
const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-canvas-deep text-ink-soft",
  coral: "bg-coral-soft text-coral-deep",
  lavender: "bg-lavender-soft text-lavender-deep",
  mint: "bg-mint-soft text-mint-deep",
  amber: "bg-amber-soft text-amber-deep",
  sky: "bg-sky-soft text-sky-deep",
  danger: "bg-danger-soft text-danger-deep",
};
export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: ReactNode;
}
export function Chip({ tone = "neutral", icon, className, children, ...rest }: ChipProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium", CHIP_TONE[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

/* ───────── Badge ───────── */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** soft = tinted bg, solid = filled, outline = border only. */
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md";
  /** Leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
}
const BADGE_SOLID: Record<ChipTone, string> = {
  neutral: "bg-ink-soft text-white",
  coral: "bg-coral text-white",
  lavender: "bg-lavender text-white",
  mint: "bg-mint text-white",
  amber: "bg-amber text-white",
  sky: "bg-sky text-white",
  danger: "bg-danger text-white",
};
const BADGE_OUTLINE: Record<ChipTone, string> = {
  neutral: "border-line text-ink-soft",
  coral: "border-coral/40 text-coral-deep",
  lavender: "border-lavender/40 text-lavender-deep",
  mint: "border-mint/40 text-mint-deep",
  amber: "border-amber/50 text-amber-deep",
  sky: "border-sky/40 text-sky-deep",
  danger: "border-danger/40 text-danger-deep",
};
export function Badge({ tone = "neutral", variant = "soft", size = "md", dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill font-medium",
        size === "sm" ? "px-2 py-px text-[11px] leading-4" : "px-2.5 py-0.5 text-xs",
        variant === "soft" && CHIP_TONE[tone],
        variant === "solid" && BADGE_SOLID[tone],
        variant === "outline" && cn("border bg-surface/60", BADGE_OUTLINE[tone]),
        className,
      )}
      {...rest}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  /** Above this shows "max+". Default 99. */
  max?: number;
  tone?: ChipTone;
  /** Render a small dot instead of the number. */
  dot?: boolean;
  showZero?: boolean;
}
/** Unread/pending counter ("需要你" bell, sidebar entries). Pops when the number changes. */
export function CountBadge({ count, max = 99, tone = "coral", dot, showZero, className, ...rest }: CountBadgeProps) {
  if (count <= 0 && !showZero) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      key={count}
      aria-label={dot ? `${count} 条未读` : undefined}
      className={cn(
        "muster-count-pop inline-flex items-center justify-center rounded-pill font-semibold tabular-nums",
        BADGE_SOLID[tone],
        dot ? "size-2.5 p-0" : "h-[18px] min-w-[18px] px-1.5 text-[11px] leading-none",
        className,
      )}
      {...rest}
    >
      {dot ? null : text}
    </span>
  );
}

/* ───────── Dot / Pulse ───────── */
const DOT_COLOR: Record<ChipTone, string> = {
  neutral: "var(--color-ink-faint)",
  coral: "var(--color-coral)",
  lavender: "var(--color-lavender)",
  mint: "var(--color-mint)",
  amber: "var(--color-amber)",
  sky: "var(--color-sky)",
  danger: "var(--color-danger)",
};
export interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** Colour from a bot status instead of a tone. */
  status?: BotStatus;
  size?: number;
  /** Radiating ping ring (alive / needs attention). */
  pulse?: boolean;
}
/** Small round state indicator. */
export function Dot({ tone = "neutral", status, size = 8, pulse, className, style, ...rest }: DotProps) {
  const color = status ? STATUS_COLOR[status] : DOT_COLOR[tone];
  return (
    <span
      className={cn("relative inline-block shrink-0 rounded-full", pulse && "muster-ping", className)}
      style={{ width: size, height: size, background: color, ...style } as CSSProperties}
      {...rest}
    />
  );
}
/** Dot that always pings. */
export function Pulse(props: Omit<DotProps, "pulse">) {
  return <Dot {...props} pulse />;
}

const STATUS_TONE: Record<BotStatus, ChipTone> = {
  idle: "neutral",
  thinking: "lavender",
  working: "mint",
  waiting_approval: "amber",
  done: "mint",
  error: "danger",
  sleeping: "neutral",
};
export { STATUS_TONE };
const STATUS_PULSE: Partial<Record<BotStatus, true>> = { working: true, thinking: true, waiting_approval: true };

export function StatusPill({ status, label, className }: { status: BotStatus; label?: string; className?: string }) {
  return (
    <Chip tone={STATUS_TONE[status]} className={cn("gap-1.5", className)} icon={<Dot status={status} size={6} pulse={STATUS_PULSE[status]} />}>
      {label ?? STATUS_LABEL[status]}
    </Chip>
  );
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  className?: string;
}
export function Segmented<T extends string>({ value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div className={cn("inline-flex rounded-pill bg-canvas-deep p-1 shadow-[inset_0_1px_2px_rgb(60_40_20/0.06)]", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-4 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-muster",
            o.value === value ? "muster-gradient-brand text-white shadow-glow-coral" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
