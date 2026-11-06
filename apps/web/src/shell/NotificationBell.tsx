// OWNER: U2. “需要你”铃铛：未处理审批数角标，点开浮层列出待审批并可直接 允许 / 拒绝。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Bell } from "lucide-react";
import { Pebble, cn } from "@muster/ui";
import { ApprovalCard } from "../components/ApprovalCard";
import { useHub } from "../lib/hub";

export function NotificationBell() {
  const approvals = useHub((s) => s.model.approvals);
  const [open, setOpen] = useState(false);
  const pending = useMemo(
    () => Object.values(approvals).filter((a) => a.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [approvals],
  );
  const n = pending.length;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={n > 0 ? `需要你（${n} 项待处理）` : "需要你"}
          className={cn(
            "relative grid size-10 place-items-center rounded-full text-ink-soft outline-none transition-all duration-200 hover:bg-white/80 hover:text-ink focus-visible:ring-2 focus-visible:ring-coral/40 active:scale-95 data-[state=open]:bg-white data-[state=open]:shadow-card",
          )}
        >
          <Bell size={20} className={cn(n > 0 && "muster-bell-ring text-coral-deep")} />
          {n > 0 && (
            <span
              key={n}
              aria-hidden
              data-testid="bell-badge"
              className="muster-badge-pop absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[11px] font-semibold tabular-nums text-white ring-2 ring-white"
            >
              {n}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          className="muster-pop muster-frost z-50 w-[min(92vw,400px)] origin-top-right rounded-[22px] bg-white/92 p-3 shadow-float outline-none"
        >
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              需要你
              {n > 0 && <span className="rounded-full bg-coral-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-coral-deep">{n}</span>}
            </h2>
            <Link to="/inbox" onClick={() => setOpen(false)} className="flex items-center gap-1 rounded-lg text-xs text-ink-soft outline-none transition-colors hover:text-coral-deep focus-visible:ring-2 focus-visible:ring-coral/40">
              全部查看
              <ArrowRight size={13} />
            </Link>
          </div>
          {n === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <Pebble status="done" size={64} />
              <div className="text-sm font-medium">都处理完啦</div>
              <div className="text-xs text-ink-faint">成员需要你批准时，会在这里提醒你</div>
            </div>
          ) : (
            <ul className="flex max-h-[min(60vh,440px)] flex-col gap-2.5 overflow-y-auto p-0.5">
              {pending.map((a) => (
                <li key={a.id}>
                  <ApprovalCard approval={a} compact />
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
