import { useMemo, useState, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "./cn";

const TRIGGER =
  "group inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-left text-sm text-fg outline-none transition-colors duration-150 hover:border-fg-3/60 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-accent/20 aria-[invalid=true]:border-danger disabled:pointer-events-none disabled:opacity-50";
const TRIGGER_SIZE = { sm: "h-8 text-caption", md: "h-9", lg: "h-10 text-body" } as const;
const PANEL = "muster-pop z-[80] overflow-hidden rounded-card border border-border bg-surface p-1 shadow-overlay outline-none";
const ITEM =
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-control px-3 py-2 text-sm text-fg outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-muted data-[selected=true]:bg-surface-muted";

/* ───────── Select ───────── */
export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Second line under the label (dropdown only). */
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Options sharing a group are listed under a small heading. */
  group?: string;
}
interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: keyof typeof TRIGGER_SIZE;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
}

function SelectItem({ o }: { o: SelectOption }) {
  return (
    <SelectPrimitive.Item value={o.value} disabled={o.disabled} className={ITEM}>
      {o.icon && <span className="grid size-5 shrink-0 place-items-center text-fg-2 [&_svg]:size-4">{o.icon}</span>}
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
        {o.description && <span className="block truncate text-xs font-normal text-fg-3">{o.description}</span>}
      </span>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-accent" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** Dropdown select (Radix). Option values must be non-empty strings. */
export function Select({ value, onValueChange, options, placeholder = "请选择", size = "md", disabled, invalid, id, className, contentClassName, ...aria }: SelectProps) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SelectOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push(o);
    }
    return order.map((g) => [g, map.get(g)!] as const);
  }, [options]);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger id={id} aria-label={aria["aria-label"]} aria-invalid={invalid || undefined} className={cn(TRIGGER, TRIGGER_SIZE[size], className)}>
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={<span className="text-fg-3">{placeholder}</span>} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-fg-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className={cn(PANEL, "min-w-[var(--radix-select-trigger-width)] max-h-[min(24rem,var(--radix-select-content-available-height))]", contentClassName)}>
          <SelectPrimitive.Viewport>
            {groups.map(([g, list]) =>
              g ? (
                <SelectPrimitive.Group key={g}>
                  <SelectPrimitive.Label className="px-3 py-1.5 text-xs font-medium text-fg-3">{g}</SelectPrimitive.Label>
                  {list.map((o) => (
                    <SelectItem key={o.value} o={o} />
                  ))}
                </SelectPrimitive.Group>
              ) : (
                list.map((o) => <SelectItem key={o.value} o={o} />)
              ),
            )}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ───────── Combobox (searchable) ───────── */
interface ComboboxOption {
  value: string;
  /** Plain text: used for display and filtering. */
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** Extra search terms. */
  keywords?: string[];
  disabled?: boolean;
}
interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Let the user commit whatever they typed (e.g. a model id that is not in the list). */
  allowCustom?: boolean;
  /** Show a clear button when a value is set. */
  clearable?: boolean;
  size?: keyof typeof TRIGGER_SIZE;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}
/** Search-to-select dropdown (Popover + cmdk). Good for long lists like models or providers. */
export function Combobox({
  options, value, onValueChange, placeholder = "请选择", searchPlaceholder = "搜索…", emptyText = "没有匹配项",
  allowCustom, clearable, size = "md", disabled, invalid, id, className, ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const query = q.trim();
  const showCustom = allowCustom && query !== "" && !options.some((o) => o.value === query);
  const pick = (v: string) => {
    onValueChange?.(v);
    setOpen(false);
  };
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ("");
      }}
    >
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          id={id}
          aria-label={aria["aria-label"]}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn(TRIGGER, TRIGGER_SIZE[size], className)}
        >
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 truncate", !value && "text-fg-3")}>
            {selected?.icon}
            <span className="truncate">{selected?.label ?? (value || placeholder)}</span>
          </span>
          {clearable && value ? (
            <span
              role="button"
              aria-label="清除"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onValueChange?.("");
              }}
              className="grid size-5 place-items-center rounded-[6px] text-fg-3 hover:bg-surface-muted hover:text-fg"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronDown className="size-4 shrink-0 text-fg-3" />
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content sideOffset={6} align="start" className={cn(PANEL, "w-[max(var(--radix-popover-trigger-width),16rem)] p-0")}>
          <Command label={placeholder} className="flex max-h-[min(22rem,var(--radix-popover-content-available-height))] flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-fg-3" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={searchPlaceholder}
                className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
              />
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-fg-3">{emptyText}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  keywords={[o.label, ...(o.keywords ?? [])]}
                  disabled={o.disabled}
                  onSelect={() => pick(o.value)}
                  className={ITEM}
                >
                  {o.icon && <span className="grid size-5 shrink-0 place-items-center text-fg-2 [&_svg]:size-4">{o.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-fg-3">{o.description}</span>}
                  </span>
                  {o.value === value && <Check className="size-4 text-accent" />}
                </Command.Item>
              ))}
              {showCustom && (
                <Command.Item forceMount value={`__custom__${query}`} onSelect={() => pick(query)} className={ITEM}>
                  使用 “<span className="font-mono text-[13px]">{query}</span>”
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
