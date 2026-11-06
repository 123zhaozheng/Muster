import type { ReactNode } from "react";
import { Card, cn } from "@muster/ui";

/** 页面外框：标题 + 副标题 + 滚动内容区。W5 的各页面共用。 */
export function PageFrame({ title, subtitle, actions, children, className }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto max-w-5xl px-8 py-8", className)}>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}

/** 带标题的分组卡片。 */
export function Section({ title, hint, right, children, className }: { title: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("mb-5 p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

/** 友好的空状态。 */
export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line bg-canvas/60 px-6 py-8 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
      {children}
    </div>
  );
}
