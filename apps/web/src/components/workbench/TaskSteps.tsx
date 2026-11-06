// 对话上方的“步骤”：真实发生过的节点（改动、测试结果、确认请求、你的插话/打断），按时间排列，点一条回到对话里那一步。
// 没有就不显示——不补伪进度。
import { useMemo, useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import type { Entry } from "@muster/protocol";
import { Dot, cn } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { buildMilestones, formatTime } from "./logic";

export function TaskSteps({ entries, onJump }: { entries: Entry[]; onJump: (entryId: string) => void }) {
  const approvals = useHub((s) => s.model.approvals);
  const steps = useMemo(() => buildMilestones(entries, approvals), [entries, approvals]);
  const [open, setOpen] = useState(false);
  const latest = steps[steps.length - 1];
  if (!latest) return null;
  // 外层与对话列同宽、同内边距，保持左右对齐。
  return (
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-5 pt-3 md:px-6">
      <section aria-label="步骤" className="overflow-hidden rounded-card border border-border bg-surface">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted"
        >
          <ListChecks aria-hidden className="size-4 shrink-0 text-fg-3" />
          <span className="shrink-0 font-medium text-fg">步骤 {steps.length}</span>
          <span className="min-w-0 flex-1 truncate text-fg-2" title={latest.text}>最新：{latest.text}</span>
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-fg-3", open && "rotate-180")} />
        </button>
        {open && (
          <ol className="max-h-64 overflow-y-auto border-t border-border p-1">
            {steps.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onJump(m.entryId)}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                >
                  <Dot tone={m.tone} className="mt-2" />
                  <span className="min-w-0 flex-1 break-words">{m.text}</span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-3">{formatTime(m.ts)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
