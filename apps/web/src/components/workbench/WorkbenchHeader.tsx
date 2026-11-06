// 工单详情头部（44px 一行）：面包屑“主线 / 成员 · 标题”+ 状态，右侧是 打断 / 取消 / 右栏开关 三个图标按钮。
import { useState } from "react";
import { Link } from "react-router";
import { CircleStop, PanelRight, Pause } from "lucide-react";
import type { Bot, Task } from "@muster/protocol";
import { ConfirmDialog, IconButton } from "@muster/ui";
import { TaskStatusBadge } from "../common";
import { isBusy } from "./logic";

interface WorkbenchHeaderProps {
  task: Task;
  bot: Bot | undefined;
  onInterrupt: () => void;
  /** 二次确认后调用；抛错则确认框保持打开。 */
  onCancel: () => void | Promise<void>;
  /** 右栏（产物与记录）的开关；是否打开由页面决定。 */
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const CANCELLABLE = new Set(["queued", "running", "waiting_approval"]);

export function WorkbenchHeader({ task, bot, onInterrupt, onCancel, panelOpen, onTogglePanel }: WorkbenchHeaderProps) {
  const [confirm, setConfirm] = useState(false);
  const member = bot?.name ?? "成员";

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <nav aria-label="面包屑" className="flex shrink-0 items-center gap-1.5 text-fg-3">
          <Link to="/" className="rounded-control hover:text-fg">主线</Link>
          <span aria-hidden>/</span>
        </nav>
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg" title={`${member} · ${task.title}`}>
          <span className="font-normal text-fg-2">{member} · </span>
          {task.title}
        </h1>
        <TaskStatusBadge status={task.status} className="ml-1 shrink-0" />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isBusy(task) && (
          <IconButton size="sm" label="打断工单" onClick={onInterrupt}>
            <Pause />
          </IconButton>
        )}
        {CANCELLABLE.has(task.status) && (
          <IconButton size="sm" label="取消工单" className="hover:text-danger" onClick={() => setConfirm(true)}>
            <CircleStop />
          </IconButton>
        )}
        <IconButton size="sm" label="产物与记录" variant={panelOpen ? "secondary" : "ghost"} aria-pressed={panelOpen} onClick={onTogglePanel}>
          <PanelRight />
        </IconButton>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title="取消这个工单？"
        description={`${member}会立即停止「${task.title}」，已产生的改动会保留在工作目录里。`}
        confirmText="确认取消"
        cancelText="再想想"
        onConfirm={onCancel}
      />
    </header>
  );
}
