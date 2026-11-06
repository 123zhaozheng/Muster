import type { ReactNode } from "react";
import { cn } from "@muster/ui";

/** 一次派发的任务组：一个细边框容器，每个工单一行、行间细线，从不嵌套卡片。 */
export function TaskGroup({ children, className, "aria-label": ariaLabel = "任务" }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("max-w-[40em] divide-y divide-border overflow-hidden rounded-card border border-border bg-surface", className)}>
      {children}
    </div>
  );
}
