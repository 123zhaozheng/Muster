// 工具折叠行：折叠时一行摘要，展开后是逐条工具调用（图标、命令、可折叠输出）。
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, FilePen, FileText, Globe, Search, SquareTerminal, Wrench, XCircle, CheckCircle2 } from "lucide-react";
import type { ToolItem } from "@muster/protocol";
import { EASE, cn } from "@muster/ui";
import { CopyButton } from "./CopyButton";
import { toolKind, toolSummaryText } from "./logic";

const KIND_ICON = { read: FileText, command: SquareTerminal, edit: FilePen, search: Search, web: Globe, other: Wrench } as const;
const KIND_TONE = {
  read: "bg-sky-soft text-sky-deep",
  command: "bg-lavender-soft text-lavender-deep",
  edit: "bg-coral-soft text-coral-deep",
  search: "bg-amber-soft text-amber-deep",
  web: "bg-mint-soft text-mint-deep",
  other: "bg-canvas-deep text-ink-soft",
} as const;

function ToolCall({ item }: { item: ToolItem }) {
  const kind = toolKind(item.tool);
  const Icon = KIND_ICON[kind];
  const failed = item.ok === false;
  const [open, setOpen] = useState(failed); // 失败的调用默认展开输出
  return (
    <li className="rounded-xl bg-surface/80 px-2.5 py-2 text-xs ring-1 ring-line/70">
      <div className="flex items-center gap-2">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", KIND_TONE[kind])}><Icon size={13} /></span>
        <span className="shrink-0 rounded-md bg-canvas-deep px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">{item.tool}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink" title={item.label}>{item.label}</span>
        {item.ok === true && <CheckCircle2 size={14} className="shrink-0 text-mint-deep" aria-label="成功" />}
        {failed && <XCircle size={14} className="shrink-0 text-danger-deep" aria-label="失败" />}
        {item.output && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "收起输出" : "展开输出"}
            onClick={() => setOpen((v) => !v)}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-canvas-deep hover:text-ink"
          >
            <ChevronDown size={14} className={cn("transition-transform duration-200 ease-muster", open && "rotate-180")} />
          </button>
        )}
      </div>
      {item.output && open && (
        <div className="relative mt-1.5">
          <pre className={cn("wb-scroll max-h-40 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 pr-9 font-mono text-[11.5px] leading-5", failed ? "bg-danger-soft/70 text-danger-deep" : "bg-canvas-deep text-ink-soft")}>{item.output}</pre>
          <CopyButton text={item.output} label="复制输出" className="absolute right-1 top-1" />
        </div>
      )}
    </li>
  );
}

export function ToolRow({ summary, items }: { summary: { reads: number; commands: number; edits: number }; items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const failedCount = items.filter((i) => i.ok === false).length;
  return (
    <div className={cn("overflow-hidden rounded-2xl border transition-colors duration-200", open ? "border-lavender/30 bg-lavender-soft/40" : "border-line/80 bg-canvas-deep/60 hover:bg-canvas-deep")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm text-ink-soft"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-lavender-soft text-lavender-deep"><Wrench size={15} /></span>
        <span className="flex-1">{toolSummaryText(summary)}</span>
        {failedCount > 0 && <span className="rounded-pill bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger-deep">{failedCount} 个失败</span>}
        {items.length > 0 && <span className="text-xs text-ink-faint">{items.length} 项</span>}
        <ChevronDown size={16} className={cn("shrink-0 transition-transform duration-200 ease-muster", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="overflow-hidden"
          >
            {items.length === 0 ? (
              <div className="px-3 pb-3 text-xs text-ink-faint">没有更多细节</div>
            ) : (
              <ul className="space-y-1.5 px-3 pb-3">
                {items.map((it, i) => <ToolCall key={i} item={it} />)}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
