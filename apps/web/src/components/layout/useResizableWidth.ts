// Persisted, clamped width for a drag-resizable panel (sidebar, context panel, list pane). Pair with <ResizeHandle {...handleProps} />.
import { useCallback, useMemo, useState } from "react";
import type { ResizeHandleProps } from "./ResizeHandle";

export interface ResizableWidthOptions {
  /** localStorage key, e.g. "muster.sidebar.width". */
  storageKey: string;
  /** Width used when nothing is stored and on double-click reset. */
  defaultWidth: number;
  min: number;
  max: number;
}

export const clampWidth = (w: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, w)));

function readWidth(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeWidth(key: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(width));
  } catch {
    /* private mode: in-memory only */
  }
}

export interface ResizableWidth {
  width: number;
  /** True while a pointer drag is in progress (turn off width transitions). */
  resizing: boolean;
  handleProps: Pick<ResizeHandleProps, "value" | "min" | "max" | "onChange" | "onCommit" | "onReset" | "onResizingChange">;
}

/** Live width updates during a drag stay in memory; the value is persisted when the drag (or key press) ends. */
export function useResizableWidth({ storageKey, defaultWidth, min, max }: ResizableWidthOptions): ResizableWidth {
  const [width, setWidth] = useState(() => clampWidth(readWidth(storageKey) ?? defaultWidth, min, max));
  const [resizing, setResizing] = useState(false);
  const onChange = useCallback((w: number) => setWidth(clampWidth(w, min, max)), [min, max]);
  const onCommit = useCallback(
    (w: number) => {
      const next = clampWidth(w, min, max);
      setWidth(next);
      writeWidth(storageKey, next);
    },
    [storageKey, min, max],
  );
  const onReset = useCallback(() => {
    setWidth(clampWidth(defaultWidth, min, max));
    writeWidth(storageKey, null);
  }, [storageKey, defaultWidth, min, max]);
  const handleProps = useMemo(
    () => ({ value: width, min, max, onChange, onCommit, onReset, onResizingChange: setResizing }),
    [width, min, max, onChange, onCommit, onReset],
  );
  return { width, resizing, handleProps };
}
