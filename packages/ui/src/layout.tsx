import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { cn } from "./cn";
import { Card } from "./basics";
import { Tooltip } from "./overlays";
import { toast } from "./toast";

/* ───────── PageHeader ───────── */
interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: ReactNode;
  /** Small avatar / icon left of the title. */
  leading?: ReactNode;
  /** Slot above the title (breadcrumb / back link). */
  breadcrumb?: ReactNode;
  /** Slot right after the title (status badge, count…). */
  meta?: ReactNode;
  className?: string;
}
/** Every page starts with this: title (28/600) + one-line description + actions on the right. No hero. */
export function PageHeader({ title, subtitle, actions, leading, breadcrumb, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          {breadcrumb && <div className="mb-1 text-caption text-fg-3">{breadcrumb}</div>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-semibold tracking-tight text-fg">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-fg-2">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ───────── Section ───────── */
interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot (buttons, filters, "查看全部"). */
  actions?: ReactNode;
  /** Wrap the body in a flat bordered Card (p-5). Default false: children render bare. */
  card?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}
/** A titled block on a page: section title (17/600) + helper text + right-side actions + body. */
export function Section({ title, description, actions, card, className, bodyClassName, children }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children != null && (card ? <Card className={cn("p-5", bodyClassName)}>{children}</Card> : <div className={bodyClassName}>{children}</div>)}
    </section>
  );
}

/* ───────── SettingsRow ───────── */
interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** The control on the right (Switch, Select, Button, current value…). */
  children?: ReactNode;
  className?: string;
}
/** One setting: label + helper text on the left, control on the right. Rows divide themselves; put them in a `Section card`. */
export function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-6 border-b border-border py-3.5 first:pt-0 last:border-b-0 last:pb-0", className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <div className="mt-0.5 text-caption text-fg-2">{description}</div>}
      </div>
      {children != null && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/* ───────── KeyValue / DescriptionList ───────── */
interface KeyValueProps {
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
function KeyValue({ label, children, mono, copyable, copyText, hint, className }: KeyValueProps) {
  const text = copyText ?? (typeof children === "string" || typeof children === "number" ? String(children) : "");
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-fg-3">{label}</dt>
      <dd className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-fg", mono && "font-mono text-[13px]")}>
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
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-control text-fg-3 transition-colors hover:bg-surface-muted hover:text-fg"
            >
              <Copy className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </dd>
      {hint && <div className="mt-0.5 text-xs text-fg-3">{hint}</div>}
    </div>
  );
}

interface DescriptionItem extends Omit<KeyValueProps, "children" | "className"> {
  value: ReactNode;
}
interface DescriptionListProps {
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
      <dl className={cn("divide-y divide-border", className)}>
        {items.map(({ value, label, mono }, i) => (
          <div key={i} className="flex items-start justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-sm text-fg-2">{label}</dt>
            <dd className={cn("min-w-0 text-right text-sm text-fg", mono && "font-mono text-[13px]")}>{value}</dd>
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
