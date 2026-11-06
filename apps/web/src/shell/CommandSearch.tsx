// Global search (Ctrl/⌘+K): centred 720px overlay over pages, members, tickets (工单) and loaded conversations.
// Keyboard: ↑/↓ (Ctrl+N/P) move, Enter opens the selected object, Esc closes and focus returns to where it was.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, Loader2, MessageSquare, Search } from "lucide-react";
import { create } from "zustand";
import { Kbd, cn } from "@muster/ui";
import { MemberAvatar } from "../components/common";
import { useHub } from "../lib/hub";
import { modLabel } from "./keys";
import { searchAll, type SearchResult } from "./search";

interface SearchStore {
  open: boolean;
  /** Element focused when the search opened; focus goes back to it on close. */
  returnTo: HTMLElement | null;
  setOpen: (open: boolean) => void;
}
export const useCommandSearch = create<SearchStore>((set, get) => ({
  open: false,
  returnTo: null,
  setOpen: (open) => set({ open, returnTo: open && !get().open && document.activeElement instanceof HTMLElement ? document.activeElement : get().returnTo }),
}));
export const openCommandSearch = (): void => useCommandSearch.getState().setOpen(true);

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.bot) return <MemberAvatar bot={r.bot} size={28} />;
  return <span className="grid size-7 shrink-0 place-items-center text-fg-2 [&_svg]:size-[18px]">{r.nav ? r.nav.icon : <MessageSquare />}</span>;
}

function Row({ r, active, id, onPick, onHover }: { r: SearchResult; active: boolean; id: string; onPick: () => void; onHover: () => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn("flex cursor-pointer items-center gap-3 rounded-control px-3 py-2", active ? "bg-surface-muted" : "")}
    >
      <ResultIcon r={r} />
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{r.label}</span>
      {r.hint && <span className="shrink-0 truncate text-xs text-fg-3">{r.hint}</span>}
      {active && <CornerDownLeft size={14} aria-hidden className="shrink-0 text-fg-3" />}
    </div>
  );
}

export function CommandSearch() {
  const open = useCommandSearch((s) => s.open);
  const setOpen = useCommandSearch((s) => s.setOpen);
  const navigate = useNavigate();
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  const threads = useHub((s) => s.model.threads);
  const entries = useHub((s) => s.model.entries);
  const status = useHub((s) => s.status);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mod = modLabel();

  const results = useMemo(() => searchAll({ bots, tasks, threads, entries }, query), [bots, tasks, threads, entries, query]);
  const loading = status === "connecting" && Object.keys(bots).length === 0;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-active="true"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, results]);

  const pick = (r: SearchResult | undefined) => {
    if (!r) return;
    setOpen(false);
    navigate(r.to);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="muster-overlay fixed inset-0 z-50 bg-fg/25" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            useCommandSearch.getState().returnTo?.focus();
          }}
          className="muster-pop fixed left-1/2 top-[14vh] z-50 w-[min(94vw,720px)] -translate-x-1/2 overflow-hidden rounded-overlay border border-border bg-surface shadow-overlay outline-none"
        >
          <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-border px-5">
            <Search size={18} className="shrink-0 text-fg-3" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="muster-search-list"
              aria-activedescendant={results[active] ? `muster-search-${active}` : undefined}
              aria-label="搜索"
              placeholder="搜索页面、成员、工单、对话…"
              className="h-14 min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-3"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} id="muster-search-list" role="listbox" aria-label="搜索结果" aria-busy={loading} className="max-h-[min(52vh,440px)] overflow-y-auto p-2">
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-fg-2">
                <Loader2 size={16} className="animate-spin" aria-hidden />
                正在加载…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-fg-2">
                没有找到“{query}”相关的内容
                <div className="mt-1 text-xs text-fg-3">试试成员名字、工单标题或页面名称</div>
              </div>
            )}
            {results.map((r, i) => (
              <div key={r.id}>
                {(i === 0 || results[i - 1]!.group !== r.group) && <div className="px-3 pb-1 pt-2 text-xs font-medium text-fg-3">{r.group}</div>}
                <Row r={r} id={`muster-search-${i}`} active={i === active} onHover={() => setActive(i)} onPick={() => pick(r)} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t border-border bg-canvas px-5 py-2.5 text-xs text-fg-3">
            <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
            <span className="flex items-center gap-1.5"><Kbd>↵</Kbd>打开</span>
            <span className="ml-auto">对话仅搜索已加载的消息 · {mod} K 随时唤起</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
