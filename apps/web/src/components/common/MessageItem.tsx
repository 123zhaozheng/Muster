import type { ReactNode } from "react";
import type { Bot } from "@muster/protocol";
import { cn } from "@muster/ui";
import { CopyButton } from "../workbench/CopyButton";
import { MemberAvatar } from "./MemberAvatar";

type Speaker = Pick<Bot, "shape" | "color" | "status" | "name">;

/** 来源标签：成员写引擎（“Codex”），Pip 不写。 */
export function sourceLabel(bot: Partial<Pick<Bot, "kind" | "engineLabel">> | undefined): string | undefined {
  return bot && bot.kind !== "main" && bot.engineLabel ? bot.engineLabel : undefined;
}

/** “头像 24 · 名字 · 来源”一行小字，放在一位成员一段内容的最上面。 */
export function SpeakerLine({ bot, source, className }: { bot: Speaker; source?: string; className?: string }) {
  return (
    <div data-testid="speaker" className={cn("mb-1.5 flex items-center gap-2 text-caption", className)}>
      <MemberAvatar bot={bot} size={24} />
      <span className="font-medium text-fg">{bot.name}</span>
      {source && <span className="text-fg-3">· {source}</span>}
    </div>
  );
}

/** 悬停 / 聚焦时才出现的一行：时间、复制及调用方的其它操作。触屏常显。 */
function HoverActions({ time, copyText, actions, align }: { time?: string; copyText?: string; actions?: ReactNode; align: "start" | "end" }) {
  if (!time && !copyText && !actions) return null;
  return (
    <div
      data-testid="message-actions"
      className={cn(
        "mt-0.5 flex h-7 items-center gap-1 text-xs text-fg-3 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {time && <span className="px-1 tabular-nums">{time}</span>}
      {copyText && <CopyButton text={copyText} label="复制" />}
      {actions}
    </div>
  );
}

interface MessageItemProps {
  /** user = 右对齐浅底气泡、无头像；pip / member = 无气泡，上方一行“头像 · 名字 · 来源”。 */
  role: "user" | "pip" | "member";
  /** pip / member 的说话人。 */
  bot?: Speaker;
  /** 来源标签，如 “Codex”。 */
  source?: string;
  /** 同一位成员连续说话时不再重复头像行。默认显示。 */
  showHeader?: boolean;
  /** 已格式化的时间，悬停时才出现。 */
  time?: string;
  /** 提供时悬停出现“复制”。 */
  copyText?: string;
  /** 其它悬停操作（如工单详情里的“从这里分支”）。 */
  actions?: ReactNode;
  /** 流式输出：末尾显示输入光标。 */
  streaming?: boolean;
  children: ReactNode;
  className?: string;
}

/** 正文：15px / 1.7，行长不超过约 40 个汉字。拼接时不经 cn：tailwind-merge 会把 text-body 当成颜色与 text-fg 合并掉。 */
const BODY = "break-words text-body text-fg";

/** 一条消息。安静：无阴影、无边框；你的消息是浅底气泡，其余是纯文字。 */
export function MessageItem({ role, bot, source, showHeader = true, time, copyText, actions, streaming, children, className }: MessageItemProps) {
  if (role === "user") {
    return (
      <div className={cn("group/msg flex flex-col items-end", className)}>
        <div data-testid="user-bubble" className={`${BODY} max-w-[min(80%,40em)] whitespace-pre-wrap rounded-card bg-surface-muted px-4 py-2.5`}>
          {children}
        </div>
        <HoverActions time={time} copyText={copyText} actions={actions} align="end" />
      </div>
    );
  }
  return (
    <div className={cn("group/msg min-w-0", className)}>
      {showHeader && bot && <SpeakerLine bot={bot} source={source} />}
      <div className={`${BODY} prose-chat max-w-[40em]`}>
        {children}
        {streaming && (
          <span className="ml-0.5 inline-block text-accent" role="status" aria-label="正在输入">
            ▍
          </span>
        )}
      </div>
      <HoverActions time={time} copyText={streaming ? undefined : copyText} actions={actions} align="start" />
    </div>
  );
}
