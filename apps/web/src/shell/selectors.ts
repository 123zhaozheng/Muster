// 侧栏用到的纯函数，便于单测。
import { MAIN_THREAD_ID } from "@muster/protocol";
import type { Approval, Thread } from "@muster/protocol";

interface RecentThread {
  id: string;
  title: string;
  /** 线程所属 Bot（用于显示小头像与状态点）。 */
  botId: string;
  /** 点击后跳转的路由：主线 -> "/"，任务线程 -> "/task/:taskId" */
  to: string;
  updatedAt: string;
}

/** 待处理审批数量（"需要你"角标）。 */
export function countPending(approvals: Record<string, Approval>): number {
  let n = 0;
  for (const a of Object.values(approvals)) if (a.status === "pending") n++;
  return n;
}

/** 最近对话：按 updatedAt 倒序；只保留主线与有任务的线程。 */
export function recentThreads(threads: Record<string, Thread>, limit = 6): RecentThread[] {
  return Object.values(threads)
    .flatMap((t): RecentThread[] => {
      if (t.id === MAIN_THREAD_ID) return [{ id: t.id, title: t.title, botId: t.botId, to: "/", updatedAt: t.updatedAt }];
      if (t.taskId) return [{ id: t.id, title: t.title, botId: t.botId, to: `/task/${t.taskId}`, updatedAt: t.updatedAt }];
      return [];
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit);
}
