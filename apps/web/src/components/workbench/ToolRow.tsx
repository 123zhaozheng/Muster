// 工具调用：每次调用一行“图标 · 白话动作 · 对象”，点开看参数和结果；连续的调用合成一行
// “共 8 次调用 · 1 次失败”，进行中默认展开，结束后自动收起。主线与工单详情共用。
import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, FilePen, FileText, Globe, Loader2, Search, SquareTerminal, Wrench, XCircle } from "lucide-react";
import type { ToolItem } from "@muster/protocol";
import { cn } from "@muster/ui";
import { toolCallCount, type ToolEntry } from "../common/stream";
import { CopyButton } from "./CopyButton";
import { toolAction, toolKind, toolSummaryText } from "./logic";

const KIND_ICON = { read: FileText, command: SquareTerminal, edit: FilePen, search: Search, web: Globe, other: Wrench } as const;

const LINE = "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control py-1 text-left text-caption text-fg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

function StatusIcon({ item, active }: { item: ToolItem; active: boolean }) {
  if (item.ok === false) return <XCircle role="img" aria-label="失败" className="size-3.5 shrink-0 text-danger" />;
  if (active && item.ok === undefined) return <Loader2 role="img" aria-label="进行中" className="size-3.5 shrink-0 animate-spin text-fg-3 motion-reduce:animate-none" />;
  const Icon = KIND_ICON[toolKind(item.tool)];
  return <Icon aria-hidden className="size-3.5 shrink-0 text-fg-3" />;
}

/** 一次工具调用：一行；点开显示工具名、完整参数与输出。 */
function ToolCall({ item, active }: { item: ToolItem; active: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const failed = item.ok === false;
  return (
    <li className="min-w-0">
      <button type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((v) => !v)} className={LINE}>
        <StatusIcon item={item} active={active} />
        <span className="shrink-0">{toolAction(item.tool)}</span>
        <span className="min-w-0 truncate font-mono text-[12.5px] text-fg" title={item.label}>{item.label}</span>
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div id={bodyId} className="mb-1.5 ml-5 mt-0.5 space-y-1.5">
          <div className="break-all font-mono text-[11.5px] leading-5 text-fg-3">
            {item.tool} · {item.label}
          </div>
          {item.output ? (
            <div className="relative">
              <pre className={cn("max-h-[min(40vh,320px)] overflow-auto whitespace-pre-wrap break-all rounded-control p-2.5 pr-10 font-mono text-[11.5px] leading-5", failed ? "bg-danger-surface text-danger" : "bg-surface-muted text-fg-2")}>
                {item.output}
              </pre>
              <CopyButton text={item.output} label="复制输出" className="absolute right-1 top-1" />
            </div>
          ) : (
            <div className="text-xs text-fg-3">没有返回内容</div>
          )}
        </div>
      )}
    </li>
  );
}

/** 一组连续的工具调用（一条或多条 tool_summary）。running：这一组还在进行。 */
export function ToolRow({ entries, running = false }: { entries: ToolEntry[]; running?: boolean }) {
  const items = entries.flatMap((e) => e.items);
  const total = entries.reduce((n, e) => n + toolCallCount(e), 0);
  const failed = items.filter((i) => i.ok === false).length;
  const [open, setOpen] = useState(running);
  const bodyId = useId();
  const wasRunning = useRef(running);
  useEffect(() => {
    // 进行中展开；结束时自动收起。用户中途手动开合不受影响，直到状态变化。
    if (wasRunning.current !== running) setOpen(running);
    wasRunning.current = running;
  }, [running]);

  if (total === 1 && items.length === 1) {
    return (
      <ul data-testid="tool-calls" className="min-w-0 max-w-[40em]">
        <ToolCall item={items[0]!} active={running} />
      </ul>
    );
  }

  const counts = entries.reduce((s, e) => ({ reads: s.reads + e.reads, commands: s.commands + e.commands, edits: s.edits + e.edits }), { reads: 0, commands: 0, edits: 0 });
  const hidden = total - items.length;
  return (
    <div data-testid="tool-calls" className="min-w-0 max-w-[40em]">
      <button type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((v) => !v)} title={toolSummaryText(counts)} className={cn(LINE, "w-auto")}>
        {running ? (
          <Loader2 role="img" aria-label="进行中" className="size-3.5 shrink-0 animate-spin text-fg-3 motion-reduce:animate-none" />
        ) : failed > 0 ? (
          <XCircle aria-hidden className="size-3.5 shrink-0 text-danger" />
        ) : (
          <Wrench aria-hidden className="size-3.5 shrink-0 text-fg-3" />
        )}
        <span className="tabular-nums">
          共 {total} 次调用
          {failed > 0 && <span className="text-danger"> · {failed} 次失败</span>}
        </span>
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div id={bodyId} className="ml-1.5 border-l-2 border-border pl-3">
          {items.length > 0 && (
            <ul>
              {items.map((it, i) => <ToolCall key={i} item={it} active={running && i === items.length - 1} />)}
            </ul>
          )}
          {hidden > 0 && <div className="py-1 text-xs text-fg-3">{items.length > 0 ? `另有 ${hidden} 次调用没有记录细节` : `${hidden} 次调用没有记录细节`}</div>}
        </div>
      )}
    </div>
  );
}
