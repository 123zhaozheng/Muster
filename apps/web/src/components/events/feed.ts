import type { Bot, BotId, HubEvent, Task, TaskId } from "@muster/protocol";

/** Minimum number of consecutive look-alike events that fold into one row. */
const RUN_MIN = 3;

export type FeedItem = { kind: "single"; event: HubEvent } | { kind: "run"; key: string; events: HubEvent[] };

const sameKind = (e: HubEvent) => `${e.source}|${e.triggerId ?? e.title}`;

/** Folds runs of RUN_MIN or more consecutive events from the same source/rule into one item. Input is newest first. */
export function foldEvents(events: HubEvent[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = 0; i < events.length; ) {
    let j = i + 1;
    while (j < events.length && sameKind(events[j]!) === sameKind(events[i]!)) j++;
    if (j - i >= RUN_MIN) out.push({ kind: "run", key: events[i]!.id, events: events.slice(i, j) });
    else for (let k = i; k < j; k++) out.push({ kind: "single", event: events[k]! });
    i = j;
  }
  return out;
}

/** Where "继续对话" goes: the event's task, else the main thread for Pip, else the member's latest task. null = nothing to continue. */
export function continueTarget(event: Pick<HubEvent, "taskId" | "botId">, bots: Record<BotId, Bot>, tasks: Record<TaskId, Task>): string | null {
  if (event.taskId && tasks[event.taskId]) return `/task/${event.taskId}`;
  const bot = event.botId ? bots[event.botId] : undefined;
  if (!bot) return null;
  if (bot.kind === "main") return "/";
  const latest = Object.values(tasks)
    .filter((t) => t.botId === bot.id)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  return latest ? `/task/${latest.id}` : null;
}
