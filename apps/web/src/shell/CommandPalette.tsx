// OWNER: U2. 命令面板（Ctrl/⌘+K）：跳转页面、找成员、找任务/线程、快捷动作。
// 其他地方想打开它：`import { openCommandPalette } from "../shell/CommandPalette"`。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { create } from "zustand";
import { Kbd, cn } from "@muster/ui";
import { BotAvatar } from "../components/BotAvatar";
import { useHub } from "../lib/hub";
import { buildCommands, filterCommands, type Command } from "./commands";
import { modLabel } from "./keys";
import { useSidebar } from "./sidebarState";

interface PaletteStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}
export const useCommandPalette = create<PaletteStore>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
export const openCommandPalette = (): void => useCommandPalette.getState().setOpen(true);

function Row({ cmd, active, id, onPick, onHover }: { cmd: Command; active: boolean; id: string; onPick: () => void; onHover: () => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn("flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 transition-colors", active ? "bg-coral-soft text-coral-deep" : "text-ink")}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", cmd.bot ? "" : active ? "bg-white/80" : "bg-canvas-deep text-ink-soft")}>
        {cmd.bot ? <BotAvatar bot={cmd.bot} size={30} /> : cmd.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{cmd.label}</span>
      {cmd.hint && <span className={cn("shrink-0 truncate text-xs", active ? "text-coral-deep/70" : "text-ink-faint")}>{cmd.hint}</span>}
      {active && <CornerDownLeft size={14} className="shrink-0 opacity-60" aria-hidden />}
    </div>
  );
}

export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const navigate = useNavigate();
  const bots = useHub((s) => s.model.bots);
  const tasks = useHub((s) => s.model.tasks);
  const threads = useHub((s) => s.model.threads);
  const toggleSidebar = useSidebar((s) => s.toggle);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mod = modLabel();

  const commands = useMemo(() => buildCommands({ bots, tasks, threads }, { toggleSidebar, mod }), [bots, tasks, threads, toggleSidebar, mod]);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

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

  const pick = (cmd: Command | undefined) => {
    if (!cmd) return;
    setOpen(false);
    if (cmd.run) cmd.run();
    else if (cmd.to) navigate(cmd.to);
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
        <Dialog.Overlay className="muster-overlay fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="muster-pop muster-frost fixed left-1/2 top-[14vh] z-50 w-[min(92vw,640px)] -translate-x-1/2 overflow-hidden rounded-[24px] bg-white/92 shadow-float outline-none"
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line/80 px-5">
            <Search size={18} className="shrink-0 text-ink-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="muster-cmd-list"
              aria-activedescendant={results[active] ? `muster-cmd-${active}` : undefined}
              aria-label="搜索命令"
              placeholder="跳转页面、找成员、找任务，或输入动作…"
              className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} id="muster-cmd-list" role="listbox" aria-label="搜索结果" className="max-h-[min(52vh,420px)] overflow-y-auto p-2">
            {results.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-ink-soft">
                没有找到“{query}”相关的内容
                <div className="mt-1 text-xs text-ink-faint">试试成员名字、任务标题，或“设置”“新建”</div>
              </div>
            )}
            {results.map((cmd, i) => (
              <div key={cmd.id}>
                {(i === 0 || results[i - 1]!.group !== cmd.group) && <div className="px-3 pb-1 pt-2 text-[11px] font-medium tracking-wide text-ink-faint">{cmd.group}</div>}
                <Row cmd={cmd} id={`muster-cmd-${i}`} active={i === active} onHover={() => setActive(i)} onPick={() => pick(cmd)} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t border-line/80 bg-canvas/60 px-5 py-2.5 text-xs text-ink-faint">
            <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
            <span className="flex items-center gap-1.5"><Kbd>↵</Kbd>打开</span>
            <span className="ml-auto flex items-center gap-1.5"><Kbd>{mod}</Kbd><Kbd>K</Kbd>随时唤起</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
