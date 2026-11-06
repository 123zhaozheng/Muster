// Vertical drag handle on a panel edge: pointer drag (with capture, rAF-throttled), double-click reset, ←/→ keys (16px), Home/End.
// Positioned absolutely, so its parent must be `relative`. A 1px line over the panel border turns accent on hover / focus / drag.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@muster/ui";
import { clampWidth as clamp } from "./useResizableWidth";

export interface ResizeHandleProps {
  /** Accessible name, e.g. "调整侧栏宽度". */
  label: string;
  /** Edge of the panel the handle sits on. "right": dragging right widens (sidebar, list). "left": dragging left widens (right panel). */
  edge: "left" | "right";
  value: number;
  min: number;
  max: number;
  /** Live width while dragging (already clamped). */
  onChange: (width: number) => void;
  /** Final width at the end of a drag or after a key press. */
  onCommit: (width: number) => void;
  /** Double-click: back to the default width. */
  onReset: () => void;
  onResizingChange?: (resizing: boolean) => void;
  /** Releasing a drag with the unclamped width below this calls onSnap instead of committing (sidebar → rail). */
  snapBelow?: number;
  onSnap?: () => void;
  /** Keyboard step in px. Default 16. */
  step?: number;
  className?: string;
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  raw: number;
  frame: number;
}

const nextFrame = (cb: () => void): number => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  cb();
  return 0;
};
const cancelFrame = (id: number) => {
  if (id && typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
};

function setBodyResizing(on: boolean): void {
  const s = document.body.style;
  s.cursor = on ? "col-resize" : "";
  s.userSelect = on ? "none" : "";
}

export function ResizeHandle({ label, edge, value, min, max, onChange, onCommit, onReset, onResizingChange, snapBelow, onSnap, step = 16, className }: ResizeHandleProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      if (drag.current) {
        cancelFrame(drag.current.frame);
        setBodyResizing(false);
      }
    },
    [],
  );

  const widthAt = (clientX: number, d: Drag) => d.startWidth + (edge === "right" ? clientX - d.startX : d.startX - clientX);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported (jsdom) */
    }
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: value, raw: value, frame: 0 };
    setDragging(true);
    setBodyResizing(true);
    onResizingChange?.(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.raw = widthAt(e.clientX, d);
    if (!d.frame)
      d.frame = nextFrame(() => {
        d.frame = 0;
        if (drag.current === d) onChange(clamp(d.raw, min, max));
      });
  };

  const end = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    cancelFrame(d.frame);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    setDragging(false);
    setBodyResizing(false);
    onResizingChange?.(false);
    if (cancelled) return onChange(d.startWidth);
    d.raw = widthAt(e.clientX, d);
    if (snapBelow !== undefined && onSnap && d.raw < snapBelow) {
      onChange(d.startWidth);
      onSnap();
      return;
    }
    const final = clamp(d.raw, min, max);
    onChange(final);
    onCommit(final);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") next = value + (e.key === "ArrowRight" ? step : -step) * (edge === "right" ? 1 : -1);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    next = clamp(next, min, max);
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      data-resizing={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn("group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none select-none outline-none", edge === "right" ? "-right-1" : "-left-1", className)}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent",
          dragging ? "bg-accent" : "bg-transparent",
        )}
      />
    </div>
  );
}
