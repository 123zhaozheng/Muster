import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Info, User } from "lucide-react";
import { MAIN_BOT_ID, type Entry } from "@muster/protocol";
import { Pebble, cn } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { ApprovalCard } from "../ApprovalCard";
import { DispatchDeck } from "./DispatchCard";
import { clockLabel } from "./time";

const MD: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-coral-deep underline decoration-coral/40 underline-offset-2 hover:decoration-coral">{children}</a>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-coral/40 pl-3 text-ink-soft">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-xl bg-canvas-deep p-3 font-mono text-xs">{children}</pre>,
  code: ({ children, className }) => <code className={cn("font-mono text-[0.9em]", !className && "rounded bg-canvas-deep px-1 py-0.5")}>{children}</code>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="border-collapse text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border border-line bg-canvas-deep px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
};

const GUTTER = "pl-[56px]";

function BotText({ botId, text, streaming, ts, now, animated }: { botId: string; text: string; streaming?: boolean; ts: string; now: number; animated: boolean }) {
  const bot = useHub((s) => s.model.bots[botId] ?? s.model.bots[MAIN_BOT_ID]);
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-11 shrink-0 place-items-center">
        {bot && <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={42} title={bot.name} lite={!animated} />}
      </div>
      <div className="min-w-0 max-w-[min(82%,760px)]">
        <div className="mb-1 flex items-baseline gap-2 text-xs text-ink-faint">
          <span className="font-medium text-ink-soft">{bot?.name ?? "Pip"}</span>
          <span className="tabular-nums">{clockLabel(ts, now)}</span>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-white/80 bg-surface/90 px-4 py-3 text-[15px] leading-relaxed shadow-soft">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{text}</ReactMarkdown>
          {streaming && <span className="muster-caret ml-0.5 inline-block animate-pulse font-bold text-coral" aria-label="正在输入">▍</span>}
        </div>
      </div>
    </div>
  );
}

function UserText({ text, ts, now }: { text: string; ts: string; now: number }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="min-w-0 max-w-[min(78%,680px)]">
        <div className="mb-1 text-right text-xs tabular-nums text-ink-faint">{clockLabel(ts, now)}</div>
        <div className="muster-gradient-brand-soft whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-coral/15 px-4 py-3 text-[15px] leading-relaxed shadow-soft">{text}</div>
      </div>
      <div className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink-faint shadow-soft ring-2 ring-white"><User className="size-5" aria-hidden /></div>
    </div>
  );
}

function Choices({ prompt, options, multi, onPick }: { prompt?: string; options: string[]; multi?: boolean; onPick: (text: string) => void }) {
  return (
    <div className={GUTTER}>
      {(prompt || multi) && <div className="mb-2 text-sm text-ink-soft">{prompt}{multi && <span className="ml-2 text-xs text-ink-faint">可多选</span>}</div>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            className="cursor-pointer rounded-pill border border-line bg-surface px-4 py-2 text-sm shadow-soft outline-none transition-[transform,box-shadow,border-color,color] duration-200 ease-muster hover:-translate-y-px hover:border-coral hover:text-coral-deep hover:shadow-lift focus-visible:ring-2 focus-visible:ring-coral/50 active:scale-[0.97]"
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
  return <ApprovalCard approval={approval} className={cn(GUTTER, "max-w-md pl-0 ml-[56px] w-full")} />;
}

/** 把连续的 dispatch 合并成一组横向卡片。 */
type DispatchEntry = Extract<Entry, { kind: "dispatch" }>;
type Block = { type: "single"; entry: Entry } | { type: "dispatches"; entries: DispatchEntry[] };
export function toBlocks(entries: Entry[]): Block[] {
  const blocks: Block[] = [];
  for (const entry of entries) {
    const last = blocks[blocks.length - 1];
    if (entry.kind === "dispatch") {
      if (last?.type === "dispatches") last.entries.push(entry);
      else blocks.push({ type: "dispatches", entries: [entry] });
    } else blocks.push({ type: "single", entry });
  }
  return blocks;
}

function renderEntry(entry: Entry, now: number, onPick: (text: string) => void, animated: boolean): ReactNode {
  switch (entry.kind) {
    case "user":
      return <UserText text={entry.text} ts={entry.ts} now={now} />;
    case "bot":
      return <BotText botId={entry.botId} text={entry.text} streaming={entry.streaming} ts={entry.ts} now={now} animated={animated} />;
    case "choices":
      return <Choices prompt={entry.prompt} options={entry.options} multi={entry.multi} onPick={onPick} />;
    case "approval":
      return <ApprovalEntry approvalId={entry.approvalId} />;
    case "system":
      return (
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-canvas-deep/80 px-3 py-1 text-xs text-ink-soft"><Info className="size-3.5" aria-hidden />{entry.text}</span>
        </div>
      );
    default:
      return null; // 主线里不会出现的类型（工具活动、diff 等）属于子 Bot 工作台
  }
}

/** Pip 正在思考（尚未开始流式输出）时的占位。 */
export function ThinkingRow({ botId }: { botId: string }) {
  const bot = useHub((s) => s.model.bots[botId]);
  return (
    <div className="flex items-center gap-3" role="status" aria-label="正在思考">
      <div className="grid size-11 shrink-0 place-items-center">
        {bot && <Pebble shape={bot.shape} color={bot.color} status="thinking" size={42} title={bot.name} />}
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-white/80 bg-surface/90 px-4 py-3 shadow-soft">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-lavender" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function Timeline({ entries, now, onPick }: { entries: Entry[]; now: number; onPick: (text: string) => void }) {
  const blocks = toBlocks(entries);
  // 只有最后一条 Bot 消息使用完整动画头像，历史消息用轻量版，保证长对话不卡
  let lastBotId: string | undefined;
  for (const e of entries) if (e.kind === "bot") lastBotId = e.id;
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((b) =>
        b.type === "dispatches" ? (
          <div key={b.entries[0]!.id} className={cn("muster-stagger", GUTTER)}>
            <DispatchDeck items={b.entries.map((d) => ({ id: d.id, botId: d.botId, taskId: d.taskId, title: d.title }))} />
          </div>
        ) : (
          <div key={b.entry.id} className="muster-stagger">
            <Fragment>{renderEntry(b.entry, now, onPick, b.entry.id === lastBotId)}</Fragment>
          </div>
        ),
      )}
    </div>
  );
}
