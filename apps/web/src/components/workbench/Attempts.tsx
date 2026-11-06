// 工单详情右栏的“方案”：同一张工单的全部尝试（现阶段即 task.fork 产生的分支家族），一行一个。
// 操作：“从这一步重来”（在该尝试的起点再开一个尝试）、“采用”（后端目前只做标记，不合并代码）。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { RotateCcw } from "lucide-react";
import type { Branch, Task, TaskId } from "@muster/protocol";
import { Badge, Button, IconButton, Tooltip, cn, toast } from "@muster/ui";
import { hubRequest, loadBranches, useHub } from "../../lib/hub";
import { MemberAvatar, TaskStatusBadge } from "../common";
import { formatTokens, taskAvatarStatus } from "./logic";

/** 沿 forkedFrom 回到最初的工单：方案都挂在它下面。 */
export function rootTaskOf(tasks: Record<TaskId, Task>, id: TaskId): Task | undefined {
  let cur = tasks[id];
  for (let guard = 0; cur?.forkedFrom && guard < 32; guard++) {
    const parent = tasks[cur.forkedFrom.taskId];
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/** 工单所属家族的根工单与全部尝试（来自 model.branches，由 loadBranches 与推送填充）。未知工单时 root 为 undefined。 */
export function useAttempts(taskId: TaskId): { root: Task | undefined; attempts: Branch[] } {
  const tasks = useHub((s) => s.model.tasks);
  const branches = useHub((s) => s.model.branches);
  return useMemo(() => {
    const root = rootTaskOf(tasks, taskId);
    if (!root) return { root, attempts: [] };
    const family = new Set(Object.values(tasks).filter((t) => rootTaskOf(tasks, t.id)?.id === root.id).map((t) => t.id));
    return { root, attempts: Object.values(branches).filter((b) => family.has(b.taskId)) };
  }, [tasks, branches, taskId]);
}

function testsText(t: Branch["tests"]): { text: string; tone: string } {
  if (!t) return { text: "未测试", tone: "text-fg-3" };
  if (t.failed > 0) return { text: `${t.failed} 个失败`, tone: "text-danger" };
  if (t.passed > 0) return { text: `${t.passed} 通过`, tone: "text-success" };
  return { text: "无测试", tone: "text-fg-3" };
}

function AttemptRow({ attempt, current, adopting, forking, onAdopt, onRetry }: { attempt: Branch; current: boolean; adopting: boolean; forking: boolean; onAdopt: () => void; onRetry: () => void }) {
  const bot = useHub((s) => s.model.bots[attempt.botId]);
  const run = useHub((s) => s.model.tasks[attempt.taskId]);
  const tests = testsText(attempt.tests);
  const adopted = !!attempt.adopted;
  return (
    <li data-testid="attempt-row" data-attempt-id={attempt.id} className={cn("group rounded-control px-2 py-1.5 hover:bg-surface-muted", current && "bg-accent-surface hover:bg-accent-surface")}>
      <div className="flex min-h-7 items-center gap-2">
        {bot && <MemberAvatar bot={{ ...bot, status: taskAvatarStatus(run, bot.status) }} size={20} />}
        {current ? (
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg" title={attempt.summary}>{attempt.label}</span>
        ) : (
          <Link to={`/task/${attempt.taskId}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg hover:text-accent" title={attempt.summary}>{attempt.label}</Link>
        )}
        {current && <Badge tone="accent" size="sm">当前</Badge>}
        {adopted && <Badge tone="success" size="sm">已采用</Badge>}
        {run && <TaskStatusBadge status={run.status} />}
      </div>
      <div className="flex min-h-7 items-center gap-2 pl-7 text-xs tabular-nums text-fg-3">
        <span>{attempt.filesChanged} 个文件</span>
        <span aria-hidden>·</span>
        <span className={tests.tone}>{tests.text}</span>
        {attempt.tokens !== undefined && (
          <>
            <span aria-hidden>·</span>
            <span>{formatTokens(attempt.tokens)}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label="从这一步重来" loading={forking} onClick={onRetry} className="size-7">
            <RotateCcw />
          </IconButton>
          <Tooltip content="目前只标记，不合并代码">
            <Button size="sm" variant="ghost" className="h-7 px-2" loading={adopting} disabled={adopted} onClick={onAdopt}>
              {adopted ? "已采用" : "采用"}
            </Button>
          </Tooltip>
        </span>
      </div>
    </li>
  );
}

/** “方案”标签内容（只在有尝试时出现）。 */
export function AttemptsTab({ task, root, attempts }: { task: Task; root: Task; attempts: Branch[] }) {
  const [adopting, setAdopting] = useState<string | null>(null);
  const [forking, setForking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fail = (what: string) => (e: unknown) => setNotice(`${what}失败：${e instanceof Error ? e.message : String(e)}`);

  const adopt = (b: Branch) => {
    setAdopting(b.id);
    setNotice(null);
    hubRequest("branch.adopt", { branchId: b.id })
      .then(() => {
        useHub.setState((s) => ({ model: { ...s.model, branches: { ...s.model.branches, [b.id]: { ...b, adopted: true } } } }));
        toast.success(`已采用「${b.label}」`);
      })
      .catch(fail("采用"))
      .finally(() => setAdopting(null));
  };
  const retry = (b: Branch) => {
    setForking(b.id);
    setNotice(null);
    hubRequest("task.fork", { taskId: root.id, entryId: b.forkEntryId })
      .then(() => {
        toast.success("已新开一个尝试");
        return loadBranches(root.id);
      })
      .catch(fail("重来"))
      .finally(() => setForking(null));
  };

  return (
    <div className="space-y-2">
      {notice && <div role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-caption text-danger">{notice}</div>}
      <ul aria-label="尝试" className="space-y-0.5">
        {attempts.map((b) => (
          <AttemptRow
            key={b.id}
            attempt={b}
            current={b.taskId === task.id}
            adopting={adopting === b.id}
            forking={forking === b.id}
            onAdopt={() => adopt(b)}
            onRetry={() => retry(b)}
          />
        ))}
      </ul>
    </div>
  );
}
