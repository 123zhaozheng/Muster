import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@muster/ui";
import { formatSpan } from "./stream";

/** “已处理 5 步 · 2m10s” */
export function processLabel(steps: number, durationMs?: number): string {
  return durationMs === undefined ? `已处理 ${steps} 步` : `已处理 ${steps} 步 · ${formatSpan(durationMs)}`;
}

/** 一轮结束后，它的思考、工具调用和中间文字收成一行灰字；点开看全部过程。 */
export function ProcessFold({ steps, durationMs, children, className }: { steps: number; durationMs?: number; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div data-testid="process-fold" className={cn("min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-control py-0.5 text-caption tabular-nums text-fg-3 hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {processLabel(steps, durationMs)}
        <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div id={bodyId} className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
          {children}
        </div>
      )}
    </div>
  );
}
