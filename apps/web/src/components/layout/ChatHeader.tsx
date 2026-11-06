// 44px conversation header (docs/14 §6.1). No page title: the left side is only the conversation name (14px/600), or a
// breadcrumb `主线 / 小码 · 修登录` inside a member conversation; the right side holds at most three small controls:
// the status pill (real counts, hidden when all are zero), the context-panel toggle and a ⋯ menu (only with real items).
//   <ChatHeader title="Pip" conversations={recent} status={{ needsYou: 2, active: 3 }} panelToggle />
//   <ChatHeader trail={[{ label: "主线", to: "/" }]} title="小码 · 修登录" panelToggle />
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { IconButton, cn } from "@muster/ui";
import { ContextPanelToggle } from "./ChatLayout";
import { useContextPanel } from "./contextPanelState";

export interface ChatHeaderCrumb {
  label: string;
  to: string;
}

/** An entry in the ⌄ conversation menu. */
export interface ChatHeaderConversation {
  id: string;
  label: string;
  to: string;
  /** Avatar or icon before the label (≤ 20px). */
  lead?: ReactNode;
}

/** An item in the ⋯ menu. */
export interface ChatHeaderMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface ChatHeaderStatus {
  /** Distinct things waiting for the user. */
  needsYou: number;
  /** Tasks queued or running. */
  active: number;
}

interface ChatHeaderProps {
  /** Conversation name, e.g. "Pip" or "小码 · 修登录". */
  title: string;
  /** Breadcrumb links before the title (member conversations): [{ label: "主线", to: "/" }]. */
  trail?: ChatHeaderCrumb[];
  /** Other recent conversations for the ⌄ menu. Empty or omitted: no chevron, the title is plain text. */
  conversations?: ChatHeaderConversation[];
  /** Real counts for the status pill; zero parts are hidden, all zero hides the pill. */
  status?: ChatHeaderStatus;
  /** The page has a context panel: show its toggle; the status pill opens it. */
  panelToggle?: boolean;
  /** ⋯ menu items. Empty or omitted: no menu. */
  menu?: ChatHeaderMenuItem[];
  className?: string;
}

const POP = "muster-pop z-50 min-w-[220px] max-w-[320px] rounded-card border border-border bg-surface p-1 shadow-overlay outline-none";
const POP_ITEM = "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-fg transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

/** "2 需要你 · 3 进行中"; null when everything is zero. */
export function statusPillText({ needsYou, active }: ChatHeaderStatus): string | null {
  const parts: string[] = [];
  if (needsYou > 0) parts.push(`${needsYou} 需要你`);
  if (active > 0) parts.push(`${active} 进行中`);
  return parts.length ? parts.join(" · ") : null;
}

function StatusPill({ status, opensPanel }: { status: ChatHeaderStatus; opensPanel: boolean }) {
  const { setOpen } = useContextPanel();
  const text = statusPillText(status);
  if (!text) return null;
  const body = (
    <>
      <span aria-hidden className={cn("size-1.5 rounded-full", status.needsYou > 0 ? "bg-warning" : "bg-accent")} />
      <span className="tabular-nums">{text}</span>
    </>
  );
  const cls = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs text-fg-2";
  return opensPanel ? (
    <button type="button" className={cn(cls, "cursor-pointer transition-colors hover:bg-surface-muted hover:text-fg")} onClick={() => setOpen(true)} title="打开此刻面板">
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function ConversationMenu({ title, conversations }: { title: string; conversations: ChatHeaderConversation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" title="切换对话" className="-mx-1.5 inline-flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-control px-1.5 transition-colors hover:bg-surface-muted">
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={POP} aria-label="最近的对话">
          <div className="px-2 pb-1 pt-1.5 text-xs text-fg-3">最近的对话</div>
          {conversations.map((c) => (
            <Link key={c.id} to={c.to} className={POP_ITEM} onClick={() => setOpen(false)}>
              {c.lead && <span className="inline-flex shrink-0">{c.lead}</span>}
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </Link>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MoreMenu({ items }: { items: ChatHeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="更多" size="sm" className="size-7 text-fg-2">
          <MoreHorizontal />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={POP}>
          <div role="menu" aria-label="更多">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={cn(POP_ITEM, "cursor-pointer", it.danger && "text-danger")}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ChatHeader({ title, trail, conversations, status, panelToggle, menu, className }: ChatHeaderProps) {
  return (
    <header className={cn("flex h-11 min-w-0 items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {trail?.map((c) => (
          <span key={c.to} className="flex shrink-0 items-center gap-1.5">
            <Link to={c.to} className="rounded-control text-fg-3 transition-colors hover:text-fg">
              {c.label}
            </Link>
            <span aria-hidden className="text-fg-3">/</span>
          </span>
        ))}
        <h1 className="flex min-w-0 items-center text-sm font-semibold text-fg">
          {conversations?.length ? <ConversationMenu title={title} conversations={conversations} /> : <span className="truncate">{title}</span>}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status && <StatusPill status={status} opensPanel={!!panelToggle} />}
        {panelToggle && <ContextPanelToggle />}
        {menu?.length ? <MoreMenu items={menu} /> : null}
      </div>
    </header>
  );
}
