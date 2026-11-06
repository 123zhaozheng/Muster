// 工单详情的消息流。你的消息右侧气泡；成员无气泡，同一位连续说话只出现一次头像行。
// 思考、工具调用默认折叠；一轮结束后整轮过程收成“已处理 N 步”。悬停时出现时间、复制和“从这里分支”。
import type { ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, CheckCircle2, Clock, FilePlus2, GitBranch, Loader2, MessageSquareReply, Pause, TriangleAlert } from "lucide-react";
import type { Bot, Entry } from "@muster/protocol";
import { Badge, cn } from "@muster/ui";
import { ApprovalNotice, MessageItem, ProcessFold, SpeakerLine, ThinkingBlock, blockSpeaker, buildStream, sourceLabel, type StreamBlock } from "../common";
import { useHub } from "../../lib/hub";
import { MarkdownPre } from "./CodeBlock";
import { ToolRow } from "./ToolRow";
import { formatTime, steerLabel } from "./logic";

interface EntryHandlers {
  /** 点“从这里分支”。 */
  onFork: (entryId: string) => void;
  forking?: boolean;
  /** 点 diff 文件：在右侧面板打开。 */
  onOpenDiff: (path: string) => void;
  /** 点 choices 选项：作为普通消息发送。 */
  onChoose: (text: string) => void;
  /** 分支页链接。 */
  branchesHref?: string;
}

interface EntryViewProps extends EntryHandlers {
  entry: Entry;
  /** 从这一步已经分出的分支数（>0 时显示入口）。 */
  branchCount?: number;
}

const MD_CLASS = [
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px]",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-medium",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-fg-2",
  "[&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1 [&_hr]:my-3 [&_hr]:border-border",
].join(" ");

const MD_COMPONENTS = { pre: MarkdownPre } as const;

const STEER_ICON = { applied: Check, next_step: MessageSquareReply, pending: Clock } as const;

/** 消息类条目把分支操作放进自己的悬停行；其它条目在下方单独一行。 */
const isMessage = (e: Entry) => e.kind === "bot" || e.kind === "user" || e.kind === "steer";
const canFork = (e: Entry) => e.kind !== "system" && e.kind !== "thinking";

/** 头像状态跟着这条消息：流式中“工作中”，否则空闲（同一成员可能同时在别的工单里忙）。 */
const speaking = (bot: Bot | undefined, working: boolean) => (bot ? { ...bot, status: working ? ("working" as const) : ("idle" as const) } : undefined);

function BotHeader({ botId }: { botId: string }) {
  const bot = useHub((s) => s.model.bots[botId]);
  return bot ? <SpeakerLine bot={speaking(bot, false)!} source={sourceLabel(bot)} /> : null;
}

function ForkActions({ entryId, handlers, branchCount = 0 }: { entryId: string; handlers: EntryHandlers; branchCount?: number }) {
  const { onFork, forking, branchesHref } = handlers;
  return (
    <>
      {branchCount > 0 && branchesHref && (
        <Link to={branchesHref} className="inline-flex h-6 items-center gap-1 rounded-control px-1.5 text-xs text-fg-2 opacity-100 hover:bg-surface-muted hover:text-accent">
          <GitBranch aria-hidden className="size-3.5" />
          从这里分出了 {branchCount} 个分支
        </Link>
      )}
      <button
        type="button"
        aria-label="从这里分支"
        disabled={forking}
        onClick={() => onFork(entryId)}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-control px-1.5 text-xs text-fg-3 hover:bg-surface-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {forking ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <GitBranch aria-hidden className="size-3.5" />}
        从这里分支
      </button>
    </>
  );
}

/** 非消息条目下方的悬停行（分支入口常显，分支按钮悬停才出现）。 */
function HoverRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 flex h-6 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 has-[a]:opacity-100">
      {children}
    </div>
  );
}

function EntryBody({ entry, header, actions, handlers }: { entry: Entry; header: boolean; actions?: ReactNode; handlers: EntryHandlers }) {
  const bots = useHub((s) => s.model.bots);
  const approval = useHub((s) => (entry.kind === "approval" ? s.model.approvals[entry.approvalId] : undefined));

  switch (entry.kind) {
    case "bot": {
      const bot = bots[entry.botId];
      return (
        <MessageItem
          role="member"
          bot={speaking(bot, !!entry.streaming)}
          source={sourceLabel(bot)}
          showHeader={header}
          time={formatTime(entry.ts)}
          copyText={entry.text}
          actions={actions}
          streaming={entry.streaming}
        >
          <div className={MD_CLASS}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{entry.text}</ReactMarkdown>
          </div>
        </MessageItem>
      );
    }
    case "thinking":
      return (
        <>
          {header && <BotHeader botId={entry.botId} />}
          <ThinkingBlock text={entry.text} streaming={entry.streaming} durationMs={entry.durationMs} startedAt={entry.ts} />
        </>
      );
    case "user":
      return <MessageItem role="user" time={formatTime(entry.ts)} copyText={entry.text} actions={actions}>{entry.text}</MessageItem>;
    case "steer": {
      const Icon = entry.mode === "interrupt" ? Pause : STEER_ICON[entry.applied];
      return (
        <div>
          <div data-testid="steer-label" className="mb-1 flex items-center justify-end gap-1 text-caption text-fg-2">
            <Icon aria-hidden className="size-3.5" />
            {steerLabel(entry)}
          </div>
          <MessageItem role="user" time={formatTime(entry.ts)} copyText={entry.text} actions={actions}>{entry.text}</MessageItem>
        </div>
      );
    }
    case "tool_summary":
      return (
        <>
          {header && <BotHeader botId={entry.botId} />}
          <ToolRow entries={[entry]} />
        </>
      );
    case "approval":
      return approval ? <ApprovalNotice approval={approval} /> : <div className="text-caption text-fg-3">这条确认请求已不可用</div>;
    case "test_result": {
      const ok = entry.failed === 0;
      const Icon = ok ? CheckCircle2 : TriangleAlert;
      return (
        <div data-testid="test-result" className="flex max-w-[40em] items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-sm">
          <Icon aria-hidden className={cn("size-4 shrink-0", ok ? "text-success" : "text-danger")} />
          <span className={cn("font-medium", ok ? "text-success" : "text-danger")}>测试{ok ? "全部通过" : "未通过"}</span>
          <span className="ml-auto tabular-nums text-fg-2">{entry.passed} 通过 · {entry.failed} 失败</span>
        </div>
      );
    }
    case "diff": {
      const add = entry.files.reduce((a, f) => a + f.additions, 0);
      const del = entry.files.reduce((a, f) => a + f.deletions, 0);
      return (
        <div className="max-w-[40em] overflow-hidden rounded-card border border-border bg-surface">
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            <FilePlus2 aria-hidden className="size-4 text-fg-3" />
            <span className="font-medium">修改了 {entry.files.length} 个文件</span>
            <span className="ml-auto font-mono text-xs text-success">+{add}</span>
            <span className="font-mono text-xs text-danger">−{del}</span>
          </div>
          {entry.files.map((f) => {
            const i = f.path.lastIndexOf("/");
            return (
              <button key={f.path} type="button" onClick={() => handlers.onOpenDiff(f.path)} className="flex w-full cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2 text-left text-sm hover:bg-surface-muted">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  <span className="text-fg-3">{i >= 0 ? f.path.slice(0, i + 1) : ""}</span>
                  <span className="font-medium">{f.path.slice(i + 1)}</span>
                </span>
                <span className="font-mono text-xs text-success">+{f.additions}</span>
                <span className="font-mono text-xs text-danger">−{f.deletions}</span>
                <span className="hidden text-xs text-accent sm:inline">查看改动</span>
              </button>
            );
          })}
        </div>
      );
    }
    case "choices":
      return (
        <div>
          {entry.prompt && <div className="mb-1.5 text-sm text-fg-2">{entry.prompt}</div>}
          <div className="flex flex-wrap gap-2">
            {entry.options.map((o) => (
              <button key={o} type="button" onClick={() => handlers.onChoose(o)} className="cursor-pointer rounded-control border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent hover:text-accent">{o}</button>
            ))}
          </div>
        </div>
      );
    case "dispatch":
      return <Badge tone="neutral">已派发：{entry.title}</Badge>;
    case "system":
      return <div className="py-1 text-center text-caption text-fg-3">{entry.text}</div>;
  }
}

/** 一条条目连同它的悬停操作。 */
function EntryShell({ entry, header, handlers, branchCount }: { entry: Entry; header: boolean; handlers: EntryHandlers; branchCount?: number }) {
  const fork = canFork(entry) ? <ForkActions entryId={entry.id} handlers={handlers} branchCount={branchCount} /> : undefined;
  const inline = isMessage(entry);
  return (
    <div className="group" data-entry-id={entry.id}>
      <EntryBody entry={entry} header={header} actions={inline ? fork : undefined} handlers={handlers} />
      {fork && !inline && <HoverRow>{fork}</HoverRow>}
    </div>
  );
}

/** 单条条目（不做分组与折叠）。 */
export function EntryView({ entry, branchCount = 0, ...handlers }: EntryViewProps) {
  return <EntryShell entry={entry} header={entry.kind === "bot"} handlers={handlers} branchCount={branchCount} />;
}

interface EntryStreamProps extends EntryHandlers {
  entries: Entry[];
  /** 成员仍在工作：最后一轮不折叠，最后一组工具调用保持展开。 */
  live: boolean;
  /** entryId -> 从这一步分出的分支数。 */
  branchCounts?: Record<string, number>;
}

function StreamBlockView({ block, header, props }: { block: StreamBlock; header: boolean; props: EntryStreamProps }) {
  const { branchCounts = {} } = props;
  switch (block.type) {
    case "entry":
      return <EntryShell entry={block.entry} header={header} handlers={props} branchCount={branchCounts[block.entry.id]} />;
    case "dispatches":
      return (
        <>
          {block.entries.map((e) => <EntryShell key={e.id} entry={e} header={false} handlers={props} branchCount={branchCounts[e.id]} />)}
        </>
      );
    case "tools": {
      const last = block.entries[block.entries.length - 1]!;
      return (
        <div className="group" data-entry-id={last.id}>
          {header && <BotHeader botId={last.botId} />}
          <ToolRow entries={block.entries} running={block.running} />
          <HoverRow>
            <ForkActions entryId={last.id} handlers={props} branchCount={branchCounts[last.id]} />
          </HoverRow>
        </div>
      );
    }
    case "process": {
      const who = blockSpeaker(block);
      return (
        <div>
          {header && who && who !== "user" && <BotHeader botId={who} />}
          <ProcessFold steps={block.steps} durationMs={block.durationMs}>
            {block.blocks.map((inner) => <StreamBlockView key={inner.key} block={inner} header={false} props={props} />)}
          </ProcessFold>
        </div>
      );
    }
  }
}

/** 整个工单对话：按轮折叠过程、合并连续工具调用。 */
export function EntryStream(props: EntryStreamProps) {
  const blocks = buildStream(props.entries, props.live);
  let speaker: string | null = null;
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b) => {
        const who = blockSpeaker(b);
        let header = false;
        if (who === "user") speaker = "user";
        else if (who && who !== speaker) {
          header = true;
          speaker = who;
        }
        return <StreamBlockView key={b.key} block={b} header={header} props={props} />;
      })}
    </div>
  );
}

/** 任务还在跑、但最后一条不是流式消息时，列表底部的一行静态状态。 */
export function WorkingNote({ bot, thinking, waitingApproval }: { bot: Bot | undefined; thinking?: boolean; waitingApproval?: boolean }) {
  const name = bot?.name ?? "成员";
  return (
    <div role="status" data-testid="typing-indicator" className="py-1 text-caption text-fg-3">
      {waitingApproval ? `${name}在等你确认` : `${name}正在${thinking ? "思考" : "工作"}…`}
    </div>
  );
}
