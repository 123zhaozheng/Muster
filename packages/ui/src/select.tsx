import { useMemo, useState, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { PebbleProps } from "./Pebble";
import { Pebble } from "./Pebble";
import { cn } from "./cn";
import { Kbd } from "./display";

const TRIGGER =
  "group inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 text-left text-sm text-ink shadow-[inset_0_1px_2px_rgb(60_40_20/0.03)] outline-none transition-[border-color,box-shadow] duration-200 hover:border-ink-faint/50 focus-visible:border-coral focus-visible:ring-4 focus-visible:ring-coral/15 data-[state=open]:border-coral data-[state=open]:ring-4 data-[state=open]:ring-coral/15 aria-[invalid=true]:border-danger disabled:pointer-events-none disabled:opacity-50";
const TRIGGER_SIZE = { sm: "h-8 text-[13px]", md: "h-10", lg: "h-12 text-base" } as const;
const PANEL = "muster-menu muster-glass-3 z-[80] overflow-hidden rounded-2xl p-1.5 outline-none";
const ITEM =
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-coral-soft data-[highlighted]:text-coral-deep data-[selected=true]:bg-coral-soft data-[selected=true]:text-coral-deep";

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
export interface SelectProps {
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
      {o.icon && <span className="grid size-5 shrink-0 place-items-center text-ink-soft [&_svg]:size-4">{o.icon}</span>}
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
        {o.description && <span className="block truncate text-xs font-normal text-ink-faint">{o.description}</span>}
      </span>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-coral" />
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
        <span className="min-w-0 flex-1 truncate data-[placeholder]:text-ink-faint">
          <SelectPrimitive.Value placeholder={<span className="text-ink-faint">{placeholder}</span>} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-ink-faint transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className={cn(PANEL, "min-w-[var(--radix-select-trigger-width)] max-h-[min(24rem,var(--radix-select-content-available-height))]", contentClassName)}>
          <SelectPrimitive.Viewport className="muster-scroll">
            {groups.map(([g, list]) =>
              g ? (
                <SelectPrimitive.Group key={g}>
                  <SelectPrimitive.Label className="px-3 py-1.5 text-xs font-medium text-ink-faint">{g}</SelectPrimitive.Label>
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
export interface ComboboxOption {
  value: string;
  /** Plain text: used for display and filtering. */
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** Extra search terms. */
  keywords?: string[];
  disabled?: boolean;
}
export interface ComboboxProps {
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
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 truncate", !value && "text-ink-faint")}>
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
              className="grid size-5 place-items-center rounded-full text-ink-faint hover:bg-canvas-deep hover:text-ink"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronDown className="size-4 shrink-0 text-ink-faint transition-transform duration-200 group-data-[state=open]:rotate-180" />
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content sideOffset={6} align="start" className={cn(PANEL, "w-[max(var(--radix-popover-trigger-width),16rem)] p-0")}>
          <Command label={placeholder} className="flex max-h-[min(22rem,var(--radix-popover-content-available-height))] flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search className="size-4 shrink-0 text-ink-faint" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={searchPlaceholder}
                className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <Command.List className="muster-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-ink-faint">{emptyText}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  keywords={[o.label, ...(o.keywords ?? [])]}
                  disabled={o.disabled}
                  onSelect={() => pick(o.value)}
                  className={ITEM}
                >
                  {o.icon && <span className="grid size-5 shrink-0 place-items-center text-ink-soft [&_svg]:size-4">{o.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-ink-faint">{o.description}</span>}
                  </span>
                  {o.value === value && <Check className="size-4 text-coral" />}
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

/* ───────── CommandPalette ───────── */
export interface CommandItemDef {
  id: string;
  label: string;
  /** Section heading; items keep their given order inside a group, groups keep first-seen order. */
  group?: string;
  icon?: ReactNode;
  /** Use a Pebble avatar instead of an icon (members). */
  pebble?: Pick<PebbleProps, "shape" | "color" | "status">;
  /** Right-aligned secondary text (path, status…). */
  hint?: ReactNode;
  /** Key caps shown on the right, e.g. ["Ctrl", "B"]. */
  shortcut?: string[];
  keywords?: string[];
  onSelect: () => void;
}
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItemDef[];
  placeholder?: string;
  emptyText?: string;
}
/**
 * Ctrl/⌘+K palette: fuzzy search over pages, members, tasks, actions. The caller owns the hotkey and the item list.
 */
export function CommandPalette({ open, onOpenChange, items, placeholder = "搜索页面、成员、任务…", emptyText = "没有找到相关内容" }: CommandPaletteProps) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, CommandItemDef[]>();
    for (const it of items) {
      const g = it.group ?? "";
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push(it);
    }
    return order.map((g) => [g, map.get(g)!] as const);
  }, [items]);
  const run = (it: CommandItemDef) => {
    onOpenChange(false);
    it.onSelect();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="muster-overlay fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="muster-palette muster-glass-3 fixed left-1/2 top-[14vh] z-50 w-[min(94vw,40rem)] -translate-x-1/2 overflow-hidden rounded-card-lg outline-none"
        >
          <DialogPrimitive.Title className="sr-only">命令面板</DialogPrimitive.Title>
          <Command label="命令面板" loop className="flex max-h-[70vh] flex-col">
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-[18px] shrink-0 text-ink-faint" />
              <Command.Input placeholder={placeholder} className="h-14 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="muster-scroll min-h-0 flex-1 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-10 text-center text-sm text-ink-faint">{emptyText}</Command.Empty>
              {groups.map(([g, list]) => (
                <Command.Group
                  key={g}
                  heading={g || undefined}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-faint"
                >
                  {list.map((it) => (
                    <Command.Item key={it.id} value={it.id} keywords={[it.label, ...(it.keywords ?? [])]} onSelect={() => run(it)} className={ITEM}>
                      {it.pebble ? (
                        <Pebble shape={it.pebble.shape} color={it.pebble.color} status={it.pebble.status} size={26} lite interactive={false} />
                      ) : (
                        it.icon && <span className="grid size-6 shrink-0 place-items-center text-ink-soft [&_svg]:size-[18px]">{it.icon}</span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="shrink-0 truncate text-xs text-ink-faint">{it.hint}</span>}
                      {it.shortcut && (
                        <span className="flex shrink-0 gap-1">
                          {it.shortcut.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-line bg-canvas/60 px-5 py-2.5 text-xs text-ink-faint">
              <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> 选择</span>
              <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> 打开</span>
              <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> 关闭</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
