import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MAIN_BOT_ID, MAIN_THREAD_ID, type Entry, type Task } from "@muster/protocol";
import { cn } from "@muster/ui";
import {
  ApprovalNotice,
  MessageItem,
  ProcessFold,
  SpeakerLine,
  TaskGroup,
  TaskRow,
  ThinkingBlock,
  blockSpeaker,
  buildStream,
  sourceLabel,
  type DispatchEntry,
  type StreamBlock,
} from "../common";
import { ToolRow } from "../workbench/ToolRow";
import { taskElapsedMs } from "../workbench/logic";
import { useHub } from "../../lib/hub";
import { clockLabel } from "./time";

const MD: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-hover">{children}</a>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-body font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 text-body font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-body font-medium">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-2">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-control bg-surface-muted p-3 font-mono text-xs">{children}</pre>,
  code: ({ children, className }) => <code className={cn("font-mono text-[0.9em]", !className && "rounded bg-surface-muted px-1 py-0.5")}>{children}</code>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="border-collapse text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border border-border bg-surface-muted px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
};

function useSpeaker(botId: string) {
  return useHub((s) => s.model.bots[botId] ?? s.model.bots[MAIN_BOT_ID]);
}

/** 一位成员一段内容的开头：头像 · 名字 · 来源。 */
function BotHeader({ botId }: { botId: string }) {
  const bot = useSpeaker(botId);
  return bot ? <SpeakerLine bot={bot} source={sourceLabel(bot)} /> : null;
}

function BotText({ botId, text, streaming, ts, now, header }: { botId: string; text: string; streaming?: boolean; ts: string; now: number; header: boolean }) {
  const bot = useSpeaker(botId);
  return (
    <MessageItem
      role={bot && bot.id !== MAIN_BOT_ID ? "member" : "pip"}
      bot={bot}
      source={sourceLabel(bot)}
      showHeader={header}
      time={clockLabel(ts, now)}
      copyText={text}
      streaming={streaming}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{text}</ReactMarkdown>
    </MessageItem>
  );
}

function Choices({ prompt, options, multi, onPick }: { prompt?: string; options: string[]; multi?: boolean; onPick: (text: string) => void }) {
  return (
    <div>
      {(prompt || multi) && <div className="mb-2 text-sm text-fg-2">{prompt}{multi && <span className="ml-2 text-caption text-fg-3">可多选</span>}</div>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            className="cursor-pointer rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function ApprovalEntry({ approvalId }: { approvalId: string }) {
  const approval = useHub((s) => s.model.approvals[approvalId]);
  if (!approval) return null;
  return <ApprovalNotice approval={approval} />;
}

function DispatchRow({ entry, now }: { entry: DispatchEntry; now: number }) {
  const bot = useHub((s) => s.model.bots[entry.botId]);
  const task: Task | undefined = useHub((s) => s.model.tasks[entry.taskId]);
  const summary = useHub((s) => (task ? s.model.threads[task.threadId]?.lastText : undefined));
  return (
    <TaskRow
      task={task ?? { id: entry.taskId, title: entry.title, status: "queued" }}
      bot={bot}
      summary={summary}
      elapsedMs={task ? taskElapsedMs(task, now) : undefined}
    />
  );
}

interface RenderCtx {
  now: number;
  onPick: (text: string) => void;
}

function renderEntry(entry: Entry, header: boolean, { now, onPick }: RenderCtx): ReactNode {
  switch (entry.kind) {
    case "user":
      return <MessageItem role="user" time={clockLabel(entry.ts, now)} copyText={entry.text}>{entry.text}</MessageItem>;
    case "bot":
      return <BotText botId={entry.botId} text={entry.text} streaming={entry.streaming} ts={entry.ts} now={now} header={header} />;
    case "thinking":
      return (
        <>
          {header && <BotHeader botId={entry.botId} />}
          <ThinkingBlock text={entry.text} streaming={entry.streaming} durationMs={entry.durationMs} startedAt={entry.ts} />
        </>
      );
    case "choices":
      return <Choices prompt={entry.prompt} options={entry.options} multi={entry.multi} onPick={onPick} />;
    case "approval":
      return <ApprovalEntry approvalId={entry.approvalId} />;
    case "system":
      return <div className="text-center text-caption text-fg-3">{entry.text}</div>;
    default:
      return null; // 改动、测试结果等只出现在工单详情
  }
}

function renderBlock(b: StreamBlock, header: boolean, ctx: RenderCtx): ReactNode {
  switch (b.type) {
    case "entry":
      return renderEntry(b.entry, header, ctx);
    case "tools":
      return (
        <>
          {header && <BotHeader botId={b.entries[0]!.botId} />}
          <ToolRow entries={b.entries} running={b.running} />
        </>
      );
    case "dispatches":
      return (
        <TaskGroup aria-label="任务派发">
          {b.entries.map((d) => <DispatchRow key={d.id} entry={d} now={ctx.now} />)}
        </TaskGroup>
      );
    case "process": {
      const who = blockSpeaker(b);
      return (
        <>
          {header && who && who !== "user" && <BotHeader botId={who} />}
          <ProcessFold steps={b.steps} durationMs={b.durationMs}>
            {b.blocks.map((inner) => <div key={inner.key}>{renderBlock(inner, false, ctx)}</div>)}
          </ProcessFold>
        </>
      );
    }
  }
}

/** Pip 正在思考（尚未开始流式输出）时的占位；模型的思考已经在流式展示时不重复出现。 */
export function ThinkingRow() {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const thinkingShown = useHub((s) => {
    const last = s.model.entries[MAIN_THREAD_ID]?.at(-1);
    return last?.kind === "thinking" && !!last.streaming;
  });
  if (thinkingShown) return null;
  return (
    <div role="status" aria-label="正在思考">
      <MessageItem role="pip" bot={pip}><span className="text-fg-3">正在思考…</span></MessageItem>
    </div>
  );
}

/**
 * 主线消息流：你的消息右侧气泡；Pip / 成员无气泡，同一位连续说话只出现一次头像行。
 * 思考、工具调用默认折叠；一轮结束后整轮过程收成“已处理 N 步”；派发是一组可展开的工单行。
 */
export function Timeline({ entries, now, onPick }: { entries: Entry[]; now: number; onPick: (text: string) => void }) {
  const live = useHub((s) => {
    const status = s.model.bots[MAIN_BOT_ID]?.status;
    return status === "thinking" || status === "working";
  });
  const blocks = buildStream(entries, live);
  const ctx: RenderCtx = { now, onPick };
  let speaker: string | null = null;
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b) => {
        const who = blockSpeaker(b);
        let header = false;
        if (who === "user") speaker = "user";
        else if (who && who !== speaker) {
          header = true;
          speaker = who;
        }
        return (
          <div key={b.key} id={`msg-${b.key}`}>
            {renderBlock(b, header, ctx)}
          </div>
        );
      })}
    </div>
  );
}
