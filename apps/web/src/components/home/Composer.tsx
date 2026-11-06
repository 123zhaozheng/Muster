import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import { MAIN_BOT_ID, type Bot } from "@muster/protocol";
import { Button, IconButton, Kbd, cn } from "@muster/ui";
import { ApprovalDock } from "../approvals/ApprovalDock";
import { MemberAvatar } from "../common";
import { useHub } from "../../lib/hub";
import { shouldSend, useSendKey } from "../../lib/preferences";
import { modLabel } from "../../shell/keys";

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 240;
const MENTION_RE = /(^|\s)@([^\s@]*)$/;

/** 光标前正在输入的 @提及：返回 `@` 的位置与已输入的查询词。 */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = MENTION_RE.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** 选中成员后写入的语义文字。 */
const mentionText = (bot: Pick<Bot, "name">) => `交给${bot.name} `;

function MentionMenu({ bots, index, onPick, onHover }: { bots: Bot[]; index: number; onPick: (b: Bot) => void; onHover: (i: number) => void }) {
  return (
    <div
      role="listbox"
      aria-label="选择成员"
      data-state="open"
      className="muster-pop absolute bottom-full left-0 z-20 mb-2 w-[300px] max-w-full overflow-hidden rounded-card border border-border bg-surface p-1.5 shadow-overlay"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-caption text-fg-3">交给谁？</div>
      <div className="max-h-[260px] overflow-y-auto">
        {bots.map((b, i) => (
          <div
            key={b.id}
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => {
              e.preventDefault(); // 不要让输入框失焦
              onPick(b);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2", i === index && "bg-accent-surface")}
          >
            <MemberAvatar bot={b} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{b.name}</div>
              <div className="truncate text-caption text-fg-3">{b.statusDetail ?? b.engineLabel}</div>
            </div>
            <span className="shrink-0 text-caption text-fg-3">{b.engineLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


/** 草稿里已经写明“交给<成员>”的成员（输入框下方的真实 chip）。 */
function mentionedBots(text: string, bots: Bot[]): Bot[] {
  return bots.filter((b) => text.includes(mentionText(b).trimEnd()));
}

/**
 * 主线输入框：圆角 18，起步约 96px，随内容增高到上限后框内滚动。
 * 左侧一个“+”（指派给成员，即插入 @）；右侧发送 / 停止。按“设置 · 通用 · 发送方式”用 Enter 或 Ctrl/⌘+Enter 发送，
 * Shift+Enter 始终换行（输入法组字中不触发发送）。输入框为空且有任务在运行时，主按钮变为“停止”（task.interrupt）。
 * 输入框正上方停靠当前待确认的审批；下方一行 12px 的小字只放真实信息（交给谁、发送方式、错误）。
 */
export function Composer({ value, onChange, onSend, inputRef, sending, error, running = 0, onStop }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  sending?: boolean;
  error?: string | null;
  /** 主线派发出去、仍在执行的任务数。 */
  running?: number;
  onStop?: () => void;
}) {
  const bots = useHub((s) => s.model.bots);
  const sendKey = useSendKey();
  const hasText = value.trim().length > 0;
  const canSend = hasText && !sending;
  const showStop = !hasText && !sending && running > 0 && !!onStop;
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const members = useMemo(() => Object.values(bots).filter((b) => b.id !== MAIN_BOT_ID).sort((a, b) => a.name.localeCompare(b.name, "zh")), [bots]);
  const mention = activeMention(value, Math.min(caret, value.length));
  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();
    return members.filter((b) => !q || b.name.toLowerCase().includes(q) || b.engineLabel.toLowerCase().includes(q) || b.kind.includes(q));
  }, [members, mention?.query, !!mention]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuOpen = !!mention && candidates.length > 0 && dismissed !== value;
  const active = Math.min(index, Math.max(0, candidates.length - 1));
  const targets = useMemo(() => mentionedBots(value, members), [value, members]);

  useEffect(() => setIndex(0), [mention?.query]);

  // 随内容自动增高，超过上限后在框内滚动
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value, inputRef]);

  // 插入提及后把光标放到插入文字之后
  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    const el = inputRef.current;
    if (pos === null || !el) return;
    pendingCaret.current = null;
    el.setSelectionRange(pos, pos);
    setCaret(pos);
  }, [value, inputRef]);

  const pick = (b: Bot) => {
    if (!mention) return;
    const end = Math.min(caret, value.length);
    const insert = mentionText(b);
    pendingCaret.current = mention.start + insert.length;
    onChange(value.slice(0, mention.start) + insert + value.slice(end));
    inputRef.current?.focus();
  };

  const insertAt = () => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? value.length;
    const ins = pos > 0 && !/\s$/.test(value.slice(0, pos)) ? " @" : "@";
    pendingCaret.current = pos + ins.length;
    setDismissed(null);
    onChange(value.slice(0, pos) + ins + value.slice(pos));
    el?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <ApprovalDock />
      <div className="relative">
        {menuOpen && <MentionMenu bots={candidates} index={active} onPick={pick} onHover={setIndex} />}
        <div className={cn("rounded-composer border border-border bg-surface px-3 pb-2 pt-3 transition-colors focus-within:border-accent", error && "border-danger")}>
          <textarea
            ref={inputRef}
            rows={2}
            value={value}
            placeholder="和 Pip 说说你的想法… 输入 @ 可以指定成员"
            aria-label="给 Pip 的消息"
            onChange={(e) => {
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setDismissed(null);
              onChange(e.target.value);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (menuOpen) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((active + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pick(candidates[active]!);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissed(value);
                  return;
                }
              }
              if (shouldSend({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, sendKey)) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            className="block min-h-[48px] max-h-[240px] w-full resize-none bg-transparent px-1 text-body text-fg outline-none placeholder:text-fg-3"
          />
          <div className="mt-1 flex items-center gap-2">
            <IconButton label="指派给成员" size="sm" onClick={insertAt} className="rounded-full">
              <Plus />
            </IconButton>
            <div className="flex-1" />
            {showStop ? (
              <IconButton label={`停止 ${running} 项进行中的任务`} variant="secondary" size="sm" onClick={onStop} className="rounded-full">
                <Square className="fill-current" />
              </IconButton>
            ) : (
              <Button variant="primary" aria-label="发送" onClick={onSend} disabled={!canSend} loading={sending} icon={<ArrowUp className="size-4" />} className="size-8 rounded-full !px-0" />
            )}
          </div>
        </div>
      </div>
      <div className="flex min-h-4 items-center gap-3 px-2 text-xs text-fg-3">
        {targets.length > 0 && (
          <span className="flex min-w-0 items-center gap-2" aria-label="交给">
            {targets.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1 truncate">
                <MemberAvatar bot={b} size={14} />
                交给 {b.name}
              </span>
            ))}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate text-right", error && "text-danger")} role={error ? "alert" : undefined}>
          {error ?? (
            <span className="inline-flex items-center gap-1">
              {sendKey === "ctrl-enter" ? (
                <><Kbd>{modLabel()}</Kbd>+<Kbd>Enter</Kbd> 发送 <span aria-hidden>·</span> <Kbd>Enter</Kbd> 换行</>
              ) : (
                <><Kbd>Enter</Kbd> 发送 <span aria-hidden>·</span> <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> 换行</>
              )}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
