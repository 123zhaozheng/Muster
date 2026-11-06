import type { ComponentProps, ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn";

const OVERLAY_BACKDROP = "muster-overlay fixed inset-0 z-50 bg-fg/25";
const CLOSE_BUTTON =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-fg-3 transition-colors hover:bg-surface-muted hover:text-fg";

/* ───────── Tabs ───────── */
export const Tabs = TabsPrimitive.Root;

interface TabsListProps extends ComponentProps<typeof TabsPrimitive.List> {
  /** line = underline tabs for page sections (default); segment = light segmented control. */
  variant?: "line" | "segment";
}
export function TabsList({ className, variant = "line", ...rest }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn("group inline-flex items-center", variant === "line" ? "gap-5 border-b border-border" : "gap-0.5 rounded-control bg-surface-muted p-0.5", className)}
      {...rest}
    />
  );
}
export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm font-medium text-fg-2 outline-none transition-colors duration-150 hover:text-fg",
        "focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-fg",
        "group-data-[variant=line]:-mb-px group-data-[variant=line]:border-b-2 group-data-[variant=line]:border-transparent group-data-[variant=line]:pb-2.5 group-data-[variant=line]:pt-1 group-data-[variant=line]:data-[state=active]:border-accent",
        "group-data-[variant=segment]:rounded-[6px] group-data-[variant=segment]:px-3 group-data-[variant=segment]:py-1 group-data-[variant=segment]:data-[state=active]:bg-surface group-data-[variant=segment]:data-[state=active]:ring-1 group-data-[variant=segment]:data-[state=active]:ring-border",
        className,
      )}
      {...rest}
    />
  );
}
export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 outline-none", className)} {...rest} />;
}

/* ───────── Tooltip ───────── */
export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
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
          <TooltipPrimitive.Content side={side} sideOffset={6} className="muster-pop z-[90] flex max-w-64 items-center gap-2 rounded-control bg-fg px-2.5 py-1.5 text-xs text-white">
            {content}
            {shortcut && <span className="rounded bg-white/15 px-1.5 py-px font-mono text-[10px] text-white/85">{shortcut}</span>}
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

interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: string;
  description?: string;
}
export function DialogContent({ title, description, className, children, ...rest }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY_BACKDROP} />
      <DialogPrimitive.Content
        className={cn(
          "muster-dialog fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-overlay border border-border bg-surface p-6 shadow-overlay outline-none",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...rest}
      >
        <DialogPrimitive.Title className="pr-8 text-section font-semibold text-fg">{title}</DialogPrimitive.Title>
        {description && <DialogPrimitive.Description className="mt-1 text-sm text-fg-2">{description}</DialogPrimitive.Description>}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close aria-label="关闭" className={cn(CLOSE_BUTTON, "absolute right-4 top-4")}>
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogFooter({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...rest} />;
}

/* ───────── Drawer (side panel; Radix Dialog: traps focus, Esc closes, focus returns to the trigger) ───────── */
export const Drawer = DialogPrimitive.Root;
export const DrawerClose = DialogPrimitive.Close;

interface DrawerContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  side?: "right" | "left";
  /** px (number) or any CSS width. Default 480; never wider than the viewport. */
  width?: number | string;
  /** Sticky footer area, usually buttons. */
  footer?: ReactNode;
  /** Extra header content on the right of the title (e.g. a status badge). */
  headerExtra?: ReactNode;
  /** Classes for the scrolling body. Default "px-6 py-5". */
  bodyClassName?: string;
}
/** Side drawer for detail panels and editors. Body scrolls, header/footer stay. */
export function DrawerContent({ title, description, side = "right", width = 480, footer, headerExtra, bodyClassName, className, children, style, ...rest }: DrawerContentProps) {
  const w = typeof width === "number" ? `${width}px` : width;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY_BACKDROP} />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex max-w-full flex-col bg-surface shadow-overlay outline-none",
          side === "right" ? "muster-drawer right-0 rounded-l-overlay border-l border-border" : "muster-drawer-left left-0 rounded-r-overlay border-r border-border",
          className,
        )}
        style={{ width: `min(100vw, ${w})`, ...style }}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...rest}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="truncate text-section font-semibold text-fg">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-fg-2">{description}</DialogPrimitive.Description>}
          </div>
          {headerExtra}
          <DialogPrimitive.Close aria-label="关闭" className={CLOSE_BUTTON}>
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName ?? "px-6 py-5")}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
