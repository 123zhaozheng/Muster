import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, cn } from "@muster/ui";
import { ResizeHandle } from "./ResizeHandle";
import { useResizableWidth } from "./useResizableWidth";

/** List pane drag range (px) at >= 768px. */
export const LIST_WIDTH_MIN = 240;
export const LIST_WIDTH_MAX = 480;
export const LIST_WIDTH_KEY = "muster.listDetail.width";

interface ListDetailProps {
  /** Left list (selectable rows). */
  list: ReactNode;
  /** Right detail. Render the page's own empty state when nothing is selected. */
  detail: ReactNode;
  /** Narrow screens (< 768px) show either the list or the detail: true = detail. */
  showDetail: boolean;
  /** Back to the list on narrow screens. */
  onBack: () => void;
  backLabel?: string;
  /** Default list column width in px at >= 768px (drag-resizable 240-480, double-click resets). Default 340. */
  listWidth?: number;
  /** localStorage key for the dragged width; give each page its own. */
  storageKey?: string;
  className?: string;
}

/** Master-detail: list on the left, detail on the right; one visible at a time below 768px (no resizing there). */
export function ListDetail({ list, detail, showDetail, onBack, backLabel = "返回列表", listWidth = 340, storageKey = LIST_WIDTH_KEY, className }: ListDetailProps) {
  const { width, handleProps } = useResizableWidth({ storageKey, defaultWidth: listWidth, min: LIST_WIDTH_MIN, max: LIST_WIDTH_MAX });
  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <div className={cn("relative min-h-0 shrink-0 max-md:w-full md:w-[var(--list-w)]", showDetail && "max-md:hidden")} style={{ "--list-w": `${width}px` } as CSSProperties}>
        <div className="h-full overflow-y-auto border-border md:border-r">{list}</div>
        <ResizeHandle label="调整列表宽度" edge="right" className="max-md:hidden" {...handleProps} />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", !showDetail && "max-md:hidden")}>
        <div className="px-5 pt-3 md:hidden">
          <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
            {backLabel}
          </Button>
        </div>
        {detail}
      </div>
    </div>
  );
}
