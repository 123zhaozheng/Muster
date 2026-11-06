// 工作台中栏的单条消息渲染。悬停时右侧出现“从这里分支”。
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FilePlus2, GitBranch, Loader2, Send, ShieldQuestion, Sparkles, TriangleAlert, User, Zap } from "lucide-react";
import type { Bot, Entry } from "@muster/protocol";
import { Chip, Pebble, cn } from "@muster/ui";
import { ApprovalCard } from "../ApprovalCard";
import { useHub } from "../../lib/hub";
import { MarkdownPre } from "./CodeBlock";
import { ToolRow } from "./ToolRow";
import { formatTime, steerLabel } from "./logic";
import "./workbench.css";

export interface EntryViewProps {
  entry: Entry;
  /** 点“从这里分支”。 */
  onFork: (entryId: string) => void;
  forking?: boolean;
  /** 点 diff 文件：在右栏打开。 */
  onOpenDiff: (path: string) => void;
  /** 点 choices 选项：作为普通消息发送。 */
  onChoose: (text: string) => void;
  /** 从这一步已经分出的分支数（>0 时显示入口）。 */
  branchCount?: number;
  /** 分支页链接。 */
  branchesHref?: string;
}

const MD_CLASS =
  "text-sm leading-[1.75] text-ink [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-coral-soft/60 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[12.5px] [&_:not(pre)>code]:text-coral-deep " +
  "[&_a]:text-coral-deep [&_a]:underline [&_a]:underline-offset-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-coral/40 [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft " +
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-line [&_th]:bg-canvas-deep [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-line [&_td]:px-2.5 [&_td]:py-1 [&_hr]:my-3 [&_hr]:border-line";

const MD_COMPONENTS = { pre: MarkdownPre } as const;

/** 左侧 36px 头像列 + 右侧内容。 */
function Row({ avatar, children, className }: { avatar: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3", className)}>
      <div className="w-9 shrink-0 pt-0.5">{avatar}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
/** 没有头像的行：与头像列对齐。 */
const Indented = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("pl-12", className)}>{children}</div>;

function Meta({ name, ts, tone }: { name: string; ts: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={cn("text-sm font-semibold", tone)}>{name}</span>
      <span className="text-xs tabular-nums text-ink-faint">{formatTime(ts)}</span>
    </div>
  );
}

const STEER_STEPS = ["pending", "next_step", "applied"] as const;

function SteerStepper({ applied }: { applied: (typeof STEER_STEPS)[number] }) {
  const at = STEER_STEPS.indexOf(applied);
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {STEER_STEPS.map((s, i) => (
        <span key={s} className={cn("h-1.5 rounded-full transition-all duration-300 ease-muster", i <= at ? "w-5 bg-lavender" : "w-2.5 bg-lavender/25", i === at && applied !== "applied" && "animate-pulse")} />
      ))}
    </span>
  );
}

function EntryBody({ entry, onOpenDiff, onChoose }: Pick<EntryViewProps, "entry" | "onOpenDiff" | "onChoose">) {
  const bots = useHub((s) => s.model.bots);
  const approval = useHub((s) => (entry.kind === "approval" ? s.model.approvals[entry.approvalId] : undefined));

  const avatarOf = (bot: Bot | undefined, streaming?: boolean) =>
    bot ? (
      <Pebble shape={bot.shape} color={bot.color} status={streaming ? "working" : "idle"} size={36} lite={!streaming} interactive={false} title={bot.name} />
    ) : (
      <span className="block size-9" />
    );

  switch (entry.kind) {
    case "bot": {
      const bot = bots[entry.botId];
      return (
        <Row avatar={avatarOf(bot, entry.streaming)}>
          <Meta name={bot?.name ?? "Bot"} ts={entry.ts} />
          <div className={MD_CLASS}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{entry.text}</ReactMarkdown>
            {entry.streaming && <span data-testid="stream-cursor" className="wb-caret ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-coral" />}
          </div>
        </Row>
      );
    }
    case "user":
      return (
        <Row avatar={<span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-canvas-deep to-line text-ink-soft"><User size={18} /></span>}>
          <Meta name="你" ts={entry.ts} />
          <div className="mt-0.5 inline-block max-w-full whitespace-pre-wrap rounded-2xl rounded-tl-md bg-canvas-deep/80 px-3.5 py-2 text-sm leading-[1.7]">{entry.text}</div>
        </Row>
      );
    case "steer": {
      const label = steerLabel(entry);
      const done = entry.applied === "applied" || entry.mode === "interrupt";
      return (
        <Row
          avatar={<span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-lavender to-lavender-deep text-white shadow-soft">{entry.mode === "interrupt" ? <Zap size={17} /> : <Send size={16} />}</span>}
          className={cn("rounded-2xl border border-lavender/25 bg-gradient-to-r from-lavender-soft to-lavender-soft/40 p-3", done && "wb-flash")}
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span key={label} data-testid="steer-label" className="wb-label-pop inline-flex items-center gap-1 text-sm font-semibold text-lavender-deep">
              {done && <Check size={14} />}
              {label}
            </span>
            {entry.mode !== "interrupt" && <SteerStepper applied={entry.applied} />}
            <span className="text-xs tabular-nums text-ink-faint">{formatTime(entry.ts)}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm leading-[1.7] text-lavender-deep">{entry.text}</div>
        </Row>
      );
    }
    case "tool_summary":
      return <Indented><ToolRow summary={entry} items={entry.items} /></Indented>;
    case "approval":
      return (
        <Indented>
          {approval ? (
            <ApprovalCard approval={approval} className={approval.status === "pending" ? "ring-2 ring-amber/40 shadow-lift" : undefined} />
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink-faint"><ShieldQuestion size={14} />审批请求已不可用</div>
          )}
        </Indented>
      );
    case "test_result": {
      const ok = entry.failed === 0;
      const total = entry.passed + entry.failed;
      return (
        <Indented>
          <div data-testid="test-result" className={cn("rounded-2xl border px-3.5 py-2.5", ok ? "border-mint/30 bg-gradient-to-r from-mint-soft to-mint-soft/40" : "border-danger/30 bg-gradient-to-r from-danger-soft to-danger-soft/40")}>
            <div className="flex items-center gap-2.5 text-sm">
              <span className={cn("grid size-6 place-items-center rounded-full text-white", ok ? "bg-mint-deep" : "bg-danger")}>{ok ? <Check size={14} /> : <TriangleAlert size={13} />}</span>
              <span className={cn("font-semibold", ok ? "text-mint-deep" : "text-danger-deep")}>测试{ok ? "全部通过" : "未通过"}</span>
              <span className="ml-auto font-medium tabular-nums">{entry.passed} 通过 · {entry.failed} 失败</span>
            </div>
            {total > 0 && (
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/60" aria-hidden>
                <span className="bg-mint transition-[width] duration-500 ease-muster" style={{ width: `${(entry.passed / total) * 100}%` }} />
                <span className="bg-danger" style={{ width: `${(entry.failed / total) * 100}%` }} />
              </div>
            )}
          </div>
        </Indented>
      );
    }
    case "diff": {
      const add = entry.files.reduce((a, f) => a + f.additions, 0);
      const del = entry.files.reduce((a, f) => a + f.deletions, 0);
      return (
        <Indented>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            <div className="flex items-center gap-2 border-b border-line bg-canvas-deep/50 px-3.5 py-2 text-sm">
              <FilePlus2 size={15} className="text-coral-deep" />
              <span className="font-medium">修改了 {entry.files.length} 个文件</span>
              <span className="ml-auto font-mono text-xs text-mint-deep">+{add}</span>
              <span className="font-mono text-xs text-danger-deep">−{del}</span>
            </div>
            {entry.files.map((f) => {
              const i = f.path.lastIndexOf("/");
              return (
                <button key={f.path} type="button" onClick={() => onOpenDiff(f.path)} className="flex w-full cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-coral-soft/40">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    <span className="text-ink-faint">{i >= 0 ? f.path.slice(0, i + 1) : ""}</span>
                    <span className="font-medium">{f.path.slice(i + 1)}</span>
                  </span>
                  <span className="font-mono text-xs text-mint-deep">+{f.additions}</span>
                  <span className="font-mono text-xs text-danger-deep">−{f.deletions}</span>
                  <span className="hidden text-xs text-coral-deep sm:inline">在右栏查看 →</span>
                </button>
              );
            })}
          </div>
        </Indented>
      );
    }
    case "choices":
      return (
        <Indented>
          {entry.prompt && <div className="mb-1.5 text-sm text-ink-soft">{entry.prompt}</div>}
          <div className="flex flex-wrap gap-2">
            {entry.options.map((o) => (
              <button key={o} type="button" onClick={() => onChoose(o)} className="cursor-pointer rounded-pill border border-line bg-surface px-3.5 py-1.5 text-sm shadow-soft transition-[transform,background-color,border-color] duration-150 ease-muster hover:-translate-y-px hover:border-coral/40 hover:bg-coral-soft/50 active:scale-95">{o}</button>
            ))}
          </div>
        </Indented>
      );
    case "dispatch":
      return <Indented><Chip tone="coral" icon={<Sparkles size={13} />}>已派发：{entry.title}</Chip></Indented>;
    case "system":
      return (
        <div className="flex items-center gap-3 py-1 text-xs text-ink-faint">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line" />
          <span>{entry.text}</span>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line" />
        </div>
      );
  }
}

export function EntryView({ entry, onFork, forking, onOpenDiff, onChoose, branchCount = 0, branchesHref }: EntryViewProps) {
  const canFork = entry.kind !== "system";
  return (
    <div className="group relative rounded-2xl py-1.5 transition-colors duration-150 hover:bg-canvas-deep/30" data-entry-id={entry.id}>
      <EntryBody entry={entry} onOpenDiff={onOpenDiff} onChoose={onChoose} />
      {branchCount > 0 && branchesHref && (
        <Indented className="mt-1.5">
          <Link to={branchesHref} className="inline-flex items-center gap-1.5 rounded-pill bg-lavender-soft px-2.5 py-1 text-xs font-medium text-lavender-deep transition-colors hover:bg-lavender/20">
            <GitBranch size={12} />
            从这里分出了 {branchCount} 个分支
          </Link>
        </Indented>
      )}
      {canFork && (
        <button
          type="button"
          aria-label="从这里分支"
          disabled={forking}
          onClick={() => onFork(entry.id)}
          className={cn(
            "absolute right-2 top-1/2 z-10 flex -translate-y-1/2 translate-x-2 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface/95 px-3 py-1.5 text-xs font-medium text-ink opacity-0 shadow-lift backdrop-blur",
            "transition-[opacity,transform,color] duration-200 ease-muster hover:text-coral-deep focus-visible:translate-x-0 focus-visible:opacity-100 group-hover:translate-x-0 group-hover:opacity-100 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {forking ? <Loader2 size={13} className="muster-spin" /> : <GitBranch size={13} />}
          从这里分支
        </button>
      )}
    </div>
  );
}

/** 流式时列表底部的“小码正在…”提示：会动的小头像 + 跳动的三个点。 */
export function TypingIndicator({ bot, thinking, waitingApproval }: { bot: Bot | undefined; thinking?: boolean; waitingApproval?: boolean }) {
  const name = bot?.name ?? "Bot";
  const status = waitingApproval ? "waiting_approval" : thinking ? "thinking" : "working";
  return (
    <div className="wb-in flex items-center gap-3 py-2" role="status" data-testid="typing-indicator">
      <div className="w-9 shrink-0">
        {bot ? <Pebble shape={bot.shape} color={bot.color} status={status} size={36} lite interactive={false} title={name} /> : <span className="block size-9" />}
      </div>
      <div className="flex items-center gap-2 rounded-pill bg-canvas-deep/70 px-3.5 py-1.5 text-sm text-ink-soft">
        <span>{waitingApproval ? `${name}在等你审批` : `${name}正在${thinking ? "思考" : "工作"}`}</span>
        {!waitingApproval && (
          <span className="flex items-center gap-1 text-coral" aria-hidden>
            <span className="wb-typing-dot" />
            <span className="wb-typing-dot" />
            <span className="wb-typing-dot" />
          </span>
        )}
      </div>
    </div>
  );
}
