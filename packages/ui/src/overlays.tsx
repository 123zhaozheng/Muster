import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { X } from "lucide-react";
import { cn } from "./cn";

/* ───────── Tabs (sliding indicator) ───────── */
export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends ComponentProps<typeof TabsPrimitive.List> {
  /** pill = capsule with a sliding highlight (default); line = underline tabs for page sections. */
  variant?: "pill" | "line";
}
export function TabsList({ className, children, variant = "pill", ...rest }: TabsListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[data-state="active"]');
    if (!el || !active || !active.offsetWidth) return setInd(null);
    setInd((p) => (p && p.x === active.offsetLeft && p.w === active.offsetWidth ? p : { x: active.offsetLeft, w: active.offsetWidth }));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const mo = new MutationObserver(measure);
    mo.observe(el, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const raf = requestAnimationFrame(() => setReady(true));
    return () => {
      mo.disconnect();
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  return (
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        "group relative inline-flex items-center gap-1",
        variant === "pill" ? "rounded-pill bg-canvas-deep p-1 shadow-[inset_0_1px_2px_rgb(60_40_20/0.06)]" : "gap-4 border-b border-line",
        className,
      )}
      {...rest}
    >
      {ind && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-0",
            variant === "pill" ? "inset-y-1 rounded-pill bg-surface shadow-soft" : "-bottom-px h-0.5 rounded-full bg-coral",
            ready && "transition-[transform,width] duration-300 ease-muster",
          )}
          style={{ width: ind.w, transform: `translateX(${ind.x}px)` }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
}
export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative z-10 inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-pill px-4 py-1.5 text-sm font-medium text-ink-soft outline-none transition-colors duration-200",
        "hover:text-ink focus-visible:ring-2 focus-visible:ring-coral/40 data-[state=active]:text-coral-deep disabled:pointer-events-none disabled:opacity-50",
        "group-data-[variant=line]:rounded-none",
        className,
      )}
      {...rest}
    />
  );
}
export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("muster-fade-in mt-4 outline-none", className)} {...rest} />;
}

/* ───────── Tooltip ───────── */
export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  /** Keyboard shortcut shown as a key cap, e.g. "Ctrl+B". */
  shortcut?: string;
}
/** Wrap any focusable element: `<Tooltip content="复制"><Button/></Tooltip>`. */
export function Tooltip({ content, children, side = "top", delayDuration = 200, shortcut }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} sideOffset={8} className="muster-menu z-[90] flex max-w-64 items-center gap-2 rounded-xl bg-ink px-3 py-1.5 text-xs text-white shadow-float">
            {content}
            {shortcut && <span className="rounded-md bg-white/15 px-1.5 py-px font-mono text-[10px] text-white/85">{shortcut}</span>}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ───────── Dialog ───────── */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: string;
  description?: string;
}
export function DialogContent({ title, description, className, children, ...rest }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="muster-overlay fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "muster-dialog muster-glass-3 fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card-lg p-6 outline-none",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...rest}
      >
        <DialogPrimitive.Title className="pr-8 text-lg font-semibold text-ink">{title}</DialogPrimitive.Title>
        {description && <DialogPrimitive.Description className="mt-1 text-sm text-ink-soft">{description}</DialogPrimitive.Description>}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close
          aria-label="关闭"
          className="absolute right-4 top-4 grid size-8 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas-deep hover:text-ink"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogFooter({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...rest} />;
}

/* ───────── Sheet (side drawer) ───────── */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  side?: "right" | "left";
  /** px (number) or any CSS width. Default 480; never wider than the viewport. */
  width?: number | string;
  /** Sticky footer area, usually buttons. */
  footer?: ReactNode;
  /** Extra header content on the right of the title (e.g. a status chip). */
  headerExtra?: ReactNode;
}
/** Right-hand drawer for detail panels and editors. Body scrolls, header/footer stay. */
export function SheetContent({ title, description, side = "right", width = 480, footer, headerExtra, className, children, style, ...rest }: SheetContentProps) {
  const w = typeof width === "number" ? `${width}px` : width;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="muster-overlay fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "muster-glass-3 fixed inset-y-0 z-50 flex max-w-full flex-col outline-none",
          side === "right" ? "muster-sheet right-0 rounded-l-card-lg" : "muster-sheet-left left-0 rounded-r-card-lg",
          className,
        )}
        style={{ width: `min(100vw, ${w})`, ...style }}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...rest}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="truncate text-lg font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-soft">{description}</DialogPrimitive.Description>}
          </div>
          {headerExtra}
          <DialogPrimitive.Close
            aria-label="关闭"
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas-deep hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="muster-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function SheetFooter({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2", className)} {...rest} />;
}

/* ───────── DropdownMenu ───────── */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...rest }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("muster-menu muster-glass-3 z-[80] min-w-44 rounded-2xl p-1.5 outline-none", className)}
        {...rest}
      />
    </DropdownPrimitive.Portal>
  );
}
export interface DropdownMenuItemProps extends ComponentProps<typeof DropdownPrimitive.Item> {
  icon?: ReactNode;
  danger?: boolean;
}
export function DropdownMenuItem({ icon, danger, className, children, ...rest }: DropdownMenuItemProps) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        danger ? "text-danger data-[highlighted]:bg-danger-soft" : "text-ink data-[highlighted]:bg-coral-soft data-[highlighted]:text-coral-deep",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  );
}
export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-3 py-1.5 text-xs font-medium text-ink-faint", className)} {...rest} />;
}
export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={cn("my-1 h-px bg-line", className)} {...rest} />;
}

/* ───────── ScrollArea ───────── */
export interface ScrollAreaProps extends ComponentProps<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
}
export function ScrollArea({ className, viewportClassName, children, ...rest }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...rest}>
      <ScrollAreaPrimitive.Viewport className={cn("size-full rounded-[inherit]", viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2.5 touch-none select-none p-0.5 transition-colors">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-ink-faint/40 hover:bg-ink-faint/70" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar orientation="horizontal" className="flex h-2.5 touch-none select-none flex-col p-0.5 transition-colors">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-ink-faint/40 hover:bg-ink-faint/70" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}
