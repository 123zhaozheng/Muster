import { useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn, useReducedMotion } from "@muster/ui";

/** "已思考 8s" / "已思考 1m 05s"；没有用时（旧数据）只写“已思考”。 */
export function thinkingLabel(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return "已思考";
  const s = Math.max(1, Math.round(durationMs / 1000));
  return s < 60 ? `已思考 ${s}s` : `已思考 ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** 思考中的三个小点：依次淡入淡出；减少动态效果时静止。 */
function Dots() {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden className="inline-flex items-end gap-[3px] pb-[3px]">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className={cn("size-[3px] rounded-full bg-current", !reduced && "animate-pulse")}
          style={reduced ? undefined : { animationDelay: `${delay}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </span>
  );
}

/** 流式思考已经持续的秒数（每秒刷新）；没有开始时间时为 undefined。 */
function useElapsedSeconds(startedAt: string | undefined, active: boolean): number | undefined {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || Number.isNaN(start)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, start]);
  if (!active || Number.isNaN(start)) return undefined;
  return Math.max(0, Math.floor((now - start) / 1000));
}

interface ThinkingBlockProps {
  text: string;
  /** 还在思考：显示“思考中”与动画点。 */
  streaming?: boolean;
  durationMs?: number;
  /** 思考开始的时间（条目 ts）；流式时据此显示“思考中 · 8s”。 */
  startedAt?: string;
  className?: string;
}

/**
 * 模型的思考过程：默认折叠成一行灰字（“思考中 · 8s” / “已思考 Xs”），点开后以更小的灰字、左侧细线展示全文，
 * 高度最多 min(40vh, 320px)，超出滚动。不加卡片和阴影，和正文保持安静的层级差。
 */
export function ThinkingBlock({ text, streaming, durationMs, startedAt, className }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const hasText = text.trim().length > 0;
  const elapsed = useElapsedSeconds(startedAt, !!streaming);
  return (
    <div data-testid="thinking" className={cn("min-w-0", className)}>
      <button
        type="button"
        aria-expanded={hasText ? open : undefined}
        aria-controls={hasText && open ? bodyId : undefined}
        disabled={!hasText}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-control py-0.5 text-caption text-fg-3 hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:text-fg-3"
      >
        {streaming ? (
          <span role="status" className="inline-flex items-end gap-0.5">
            思考中{elapsed !== undefined && <span className="tabular-nums"> · {elapsed}s</span>}
            <Dots />
          </span>
        ) : (
          <span>{thinkingLabel(durationMs)}</span>
        )}
        {hasText && <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
      </button>
      {hasText && open && (
        <div
          id={bodyId}
          className="mt-1 max-h-[min(40vh,320px)] max-w-[40em] overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-caption leading-relaxed text-fg-3"
        >
          {text}
        </div>
      )}
    </div>
  );
}
