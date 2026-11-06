// Conversation layout (docs/14 §6.1): a 44px ChatHeader row, a centred 760px message column and an on-demand context
// panel on the right (closed by default; 340px, its left edge is a drag handle, 300-560px, width persisted).
//   <ChatLayout header={<ChatHeader title="Pip" status={…} panelToggle />} footer={<Composer />} panel={<>…<ContextSection/>…</>} panelTitle="此刻">
//     …messages…
//   </ChatLayout>
// >= 1440px the panel is inline and its open/closed state persists; below that it opens as a drawer.
import { useEffect, type ReactNode, type Ref, type UIEventHandler } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Drawer, DrawerContent, IconButton, cn } from "@muster/ui";
import { CONTEXT_PANEL_WIDTH, useContextPanel, watchContextPanelViewport } from "./contextPanelState";
import { ResizeHandle } from "./ResizeHandle";
import { useResizableWidth } from "./useResizableWidth";

/** 28px header icon button that opens / closes the context panel ("打开上下文" / "收起上下文"). */
export function ContextPanelToggle({ className }: { className?: string }) {
  const { open, toggle } = useContextPanel();
  return (
    <IconButton label={open ? "收起上下文" : "打开上下文"} size="sm" className={cn("size-7 text-fg-2", className)} onClick={toggle} aria-pressed={open}>
      {open ? <PanelRightClose /> : <PanelRightOpen />}
    </IconButton>
  );
}

/** Panel chrome (inline variant): title + close, scrolling body, resize handle on the left edge. */
function ContextPanel({ title, onClose, children, className }: { title: ReactNode; onClose: () => void; children: ReactNode; className?: string }) {
  const { width, handleProps } = useResizableWidth(CONTEXT_PANEL_WIDTH);
  return (
    <aside
      aria-label={typeof title === "string" ? title : "上下文"}
      style={{ width }}
      className={cn("relative flex min-w-[300px] shrink flex-col border-l border-border bg-surface", className)}
    >
      <ResizeHandle label="调整上下文面板宽度" edge="left" {...handleProps} />
      <div className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <IconButton label="关闭面板" size="sm" className="size-7 text-fg-2" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 pt-1">{children}</div>
    </aside>
  );
}

/** A group inside the panel ("需要你", "进行中", …): a 12px muted heading over compact rows. */
export function ContextSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="flex h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-fg-3">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

interface ChatLayoutProps {
  /** 44px header row (usually a ChatHeader). Spans the full column width. */
  header?: ReactNode;
  /** Composer, pinned under the scroll area, same 760px width. */
  footer?: ReactNode;
  /** Context panel content. Omit for pages without a panel. */
  panel?: ReactNode;
  panelTitle?: string;
  /** The scrolling message area, for stick-to-bottom / "有新消息" logic. */
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}

export function ChatLayout({ header, footer, panel, panelTitle = "此刻", scrollRef, onScroll, className, children }: ChatLayoutProps) {
  const { open, inline, setOpen } = useContextPanel();
  useEffect(() => watchContextPanelViewport(), []);
  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <div className={cn("flex flex-1 flex-col", panel && inline && open ? "min-w-[400px]" : "min-w-0")}>
        {header && <div className="flex h-11 shrink-0 items-center px-3 md:px-4 [&>*]:w-full">{header}</div>}
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-5 py-6 md:px-6">{children}</div>
        </div>
        {footer && (
          <div className="shrink-0 px-5 pb-5 md:px-6">
            <div className="mx-auto w-full max-w-[760px]">{footer}</div>
          </div>
        )}
      </div>
      {panel && inline && open && (
        <ContextPanel title={panelTitle} onClose={() => setOpen(false)}>
          {panel}
        </ContextPanel>
      )}
      {panel && !inline && (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent title={panelTitle} width={320}>
            <div className="space-y-5">{panel}</div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
