import { useId, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Copy, Minus } from "lucide-react";
import { cn } from "./cn";
import { EASE, usePrefersReducedMotion } from "./motion";
import { Pebble, type PebbleProps } from "./Pebble";
import { Card, type ChipTone } from "./basics";
import { AnimatedNumber, Skeleton, type AvatarGroupItem } from "./display";
import { Tooltip } from "./overlays";
import { toast } from "./toast";

/* ───────── PageHeader ───────── */
export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned primary actions (buttons). */
  actions?: ReactNode;
  /** Mascot tile on the left of the title. */
  pebble?: Pick<PebbleProps, "shape" | "color" | "status"> & { size?: number };
  /** Small leading icon tile, used instead of `pebble`. */
  icon?: ReactNode;
  /** Slot above the title (breadcrumb / back link). */
  breadcrumb?: ReactNode;
  /** Slot right after the title (status chip, count…). */
  meta?: ReactNode;
  className?: string;
}
/** Every page starts with this: big title (28/34) + one-line subtitle + primary actions on the right. */
export function PageHeader({ title, subtitle, actions, pebble, icon, breadcrumb, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("muster-page-enter flex flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-4">
        {pebble && (
          <div className="muster-gradient-brand-soft relative grid size-[68px] shrink-0 place-items-center rounded-[22px] border border-white/70 shadow-soft">
            <Pebble shape={pebble.shape} color={pebble.color} status={pebble.status} size={pebble.size ?? 48} halo />
          </div>
        )}
        {!pebble && icon && <div className="muster-gradient-brand-soft grid size-12 shrink-0 place-items-center rounded-2xl text-coral-deep shadow-soft">{icon}</div>}
        <div className="min-w-0">
          {breadcrumb && <div className="mb-1 text-xs text-ink-faint">{breadcrumb}</div>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight text-ink">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-1 text-sm leading-[22px] text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/* ───────── Section ───────── */
export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned slot (buttons, filters, "查看全部"). `action` is an alias. */
  actions?: ReactNode;
  action?: ReactNode;
  /** Wrap children in a Card (p-5). Default false: children render bare. */
  card?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}
/** A titled block on a page: section title (17 semibold) + helper text + right-side actions + body. */
export function Section({ title, description, icon, actions, action, card, className, bodyClassName, children }: SectionProps) {
  const right = actions ?? action;
  return (
    <section className={cn("space-y-3.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold leading-6 text-ink">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {children != null && (card ? <Card className={cn("p-5", bodyClassName)}>{children}</Card> : <div className={bodyClassName}>{children}</div>)}
    </section>
  );
}

/* ───────── Sparkline ───────── */
const SPARK_COLOR: Record<ChipTone, string> = {
  neutral: "#a69b92",
  coral: "#ff6b4a",
  lavender: "#8b7cf6",
  mint: "#34c58a",
  amber: "#f5a524",
  sky: "#5aa9f5",
  danger: "#e5484d",
};
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: ChipTone;
  className?: string;
}
/** Tiny trend line with a soft area fill; draws itself in on mount. */
export function Sparkline({ data, width = 96, height = 34, tone = "coral", className }: SparklineProps) {
  const uid = useId().replace(/:/g, "");
  const reduced = usePrefersReducedMotion();
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * (width - pad * 2), height - pad - ((v - min) / span) * (height - pad * 2)] as const);
  // smooth with midpoint quadratic curves
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    d += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${((px + x) / 2).toFixed(1)} ${((py + y) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` T${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  const area = `${d} L${last[0].toFixed(1)} ${height} L${pts[0]![0].toFixed(1)} ${height} Z`;
  const color = SPARK_COLOR[tone];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: EASE as unknown as [number, number, number, number] }}
      />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="#fff" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

/* ───────── StatCard ───────── */
const ICON_TILE: Record<ChipTone, string> = {
  neutral: "bg-canvas-deep text-ink-soft",
  coral: "bg-coral-soft text-coral-deep",
  lavender: "bg-lavender-soft text-lavender-deep",
  mint: "bg-mint-soft text-mint-deep",
  amber: "bg-amber-soft text-amber-deep",
  sky: "bg-sky-soft text-sky-deep",
  danger: "bg-danger-soft text-danger-deep",
};
export interface StatCardProps {
  label: ReactNode;
  value: number | string;
  icon?: ReactNode;
  tone?: ChipTone;
  /** Numeric values only. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  /** Change vs the previous period, in percent. Positive = up. */
  trend?: { value: number; label?: string; /** true when up is bad (cost, errors) */ inverse?: boolean };
  hint?: ReactNode;
  sparkline?: number[];
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}
/** Overview tile: icon, label, big rolling number, trend and optional sparkline. */
export function StatCard({ label, value, icon, tone = "coral", decimals, prefix, suffix, format, trend, hint, sparkline, loading, onClick, className }: StatCardProps) {
  const dir = trend ? Math.sign(trend.value) : 0;
  const good = trend ? (trend.inverse ? dir < 0 : dir > 0) : false;
  const bad = trend ? (trend.inverse ? dir > 0 : dir < 0) : false;
  const TrendIcon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <Card
      hoverable={!!onClick}
      className={cn("relative overflow-hidden p-5 text-left", className)}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
    >
      <div>
        <div className="flex items-center gap-2.5">
          {icon && <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", ICON_TILE[tone])}>{icon}</span>}
          <span className="truncate text-sm font-medium text-ink-soft">{label}</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <div className="text-[30px] font-semibold leading-9 tracking-tight text-ink">
                {typeof value === "number" ? <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} format={format} /> : value}
              </div>
            )}
            {(trend || hint) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {trend && (
                  <span className={cn("inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 font-medium", good ? "bg-mint-soft text-mint-deep" : bad ? "bg-danger-soft text-danger-deep" : "bg-canvas-deep text-ink-soft")}>
                    <TrendIcon className="size-3.5" />
                    {Math.abs(trend.value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%
                  </span>
                )}
                {(trend?.label || hint) && <span className="text-ink-faint">{trend?.label ?? hint}</span>}
              </div>
            )}
          </div>
          {sparkline && !loading && <Sparkline data={sparkline} tone={tone} />}
        </div>
      </div>
    </Card>
  );
}

/* ───────── KeyValue / DescriptionList ───────── */
export interface KeyValueProps {
  label: ReactNode;
  children: ReactNode;
  /** Monospace value (ids, paths, model names). */
  mono?: boolean;
  /** Adds a copy button; the value must be a string unless `copyText` is given. */
  copyable?: boolean;
  copyText?: string;
  hint?: ReactNode;
  className?: string;
}
/** One label/value pair, stacked. Must live inside a <dl> (DescriptionList does that for you). */
export function KeyValue({ label, children, mono, copyable, copyText, hint, className }: KeyValueProps) {
  const text = copyText ?? (typeof children === "string" || typeof children === "number" ? String(children) : "");
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-ink-faint">{label}</dt>
      <dd className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink", mono && "font-mono text-[13px]")}>
        <span className="min-w-0 break-words">{children}</span>
        {copyable && text && (
          <Tooltip content="复制">
            <button
              type="button"
              aria-label="复制"
              onClick={() => {
                void navigator.clipboard?.writeText(text);
                toast.success("已复制");
              }}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-canvas-deep hover:text-ink"
            >
              <Copy className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </dd>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

export interface DescriptionItem extends Omit<KeyValueProps, "children" | "className"> {
  value: ReactNode;
}
export interface DescriptionListProps {
  items: DescriptionItem[];
  /** Grid columns (stacked layout). Default 2. */
  columns?: 1 | 2 | 3 | 4;
  /** stacked = label above value in a grid; rows = label left / value right with dividers. */
  layout?: "stacked" | "rows";
  className?: string;
}
const COLS = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" } as const;
/** Details block: `<DescriptionList items={[{ label: "模型", value: "gpt-5", mono: true, copyable: true }]} />`. */
export function DescriptionList({ items, columns = 2, layout = "stacked", className }: DescriptionListProps) {
  if (layout === "rows") {
    return (
      <dl className={cn("divide-y divide-line", className)}>
        {items.map(({ value, label, ...rest }, i) => (
          <div key={i} className="flex items-start justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-sm text-ink-soft">{label}</dt>
            <dd className={cn("min-w-0 text-right text-sm text-ink", rest.mono && "font-mono text-[13px]")}>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn("grid gap-x-8 gap-y-4", COLS[columns], className)}>
      {items.map(({ value, ...rest }, i) => (
        <KeyValue key={i} {...rest}>
          {value}
        </KeyValue>
      ))}
    </dl>
  );
}

/* ───────── AvatarStack ───────── */
export interface AvatarStackProps {
  items: AvatarGroupItem[];
  size?: number;
  max?: number;
  /** Cheap animations (breathing + blinking only). Default true. */
  lite?: boolean;
  className?: string;
}
/** Overlapping Pebbles with name tooltips; the stack fans out on hover. */
export function AvatarStack({ items, size = 32, max = 5, lite = true, className }: AvatarStackProps) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const ring = "rounded-full bg-surface ring-2 ring-white shadow-soft";
  return (
    <div className={cn("group inline-flex items-center", className)} role="group" aria-label={`${items.length} 位成员`}>
      {shown.map((b, i) => {
        const node = (
          <span
            className={cn(ring, "grid cursor-default place-items-center transition-[margin,transform] duration-300 ease-muster hover:z-10 hover:-translate-y-0.5", i > 0 && "-ml-2.5 group-hover:-ml-1")}
            style={{ width: size, height: size }}
          >
            <Pebble shape={b.shape} color={b.color} status={b.status} size={Math.round(size * 0.86)} title={b.name} lite={lite} interactive={false} />
          </span>
        );
        return b.name ? (
          <Tooltip key={b.id ?? i} content={b.name}>
            {node}
          </Tooltip>
        ) : (
          <span key={b.id ?? i} className="contents">{node}</span>
        );
      })}
      {rest > 0 && (
        <span className={cn(ring, "-ml-2.5 grid place-items-center bg-canvas-deep text-xs font-medium text-ink-soft group-hover:-ml-1 transition-[margin] duration-300 ease-muster")} style={{ width: size, height: size }}>
          +{rest}
        </span>
      )}
    </div>
  );
}

/** Horizontal rule with the fading brand hairline. */
export function Divider({ className, ...rest }: ComponentProps<"div">) {
  return <div role="separator" className={cn("muster-hairline w-full", className)} {...rest} />;
}
