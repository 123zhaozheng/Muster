import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AtSign, Mic, Paperclip, Send } from "lucide-react";
import { MAIN_BOT_ID, type Bot } from "@muster/protocol";
import { Button, Kbd, Pebble, Tooltip, cn } from "@muster/ui";
import { useHub } from "../../lib/hub";

const MIN_HEIGHT = 56;
const MAX_HEIGHT = 200;
const MENTION_RE = /(^|\s)@([^\s@]*)$/;

/** 光标前正在输入的 @提及：返回 `@` 的位置与已输入的查询词。 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = MENTION_RE.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** 选中成员后写入的语义文字。 */
export const mentionText = (bot: Pick<Bot, "name">) => `交给${bot.name} `;

function MentionMenu({ bots, index, onPick, onHover }: { bots: Bot[]; index: number; onPick: (b: Bot) => void; onHover: (i: number) => void }) {
  return (
    <div
      role="listbox"
      aria-label="选择成员"
      data-state="open"
      className="muster-pop muster-glass-3 absolute bottom-full left-4 z-20 mb-2 w-[300px] max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl p-1.5 shadow-pop"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-xs text-ink-faint">交给谁？</div>
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
            className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors", i === index ? "bg-coral-soft" : "hover:bg-canvas-deep/70")}
          >
            <Pebble shape={b.shape} color={b.color} status={b.status} size={30} lite interactive={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{b.name}</div>
              <div className="truncate text-xs text-ink-faint">{b.statusDetail ?? b.engineLabel}</div>
            </div>
            <span className="shrink-0 text-xs text-ink-faint">{b.engineLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 主线输入框：更大、可 @ 成员；Enter 发送，Shift+Enter 换行（输入法组字中不触发发送）。 */
export function Composer({ value, onChange, onSend, inputRef, sending, error }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  sending?: boolean;
  error?: string | null;
}) {
  const bots = useHub((s) => s.model.bots);
  const canSend = value.trim().length > 0 && !sending;
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const mention = activeMention(value, Math.min(caret, value.length));
  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();
    return Object.values(bots)
      .filter((b) => b.id !== MAIN_BOT_ID)
      .filter((b) => !q || b.name.toLowerCase().includes(q) || b.engineLabel.toLowerCase().includes(q) || b.kind.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [bots, mention?.query, !!mention]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuOpen = !!mention && candidates.length > 0 && dismissed !== value;
  const active = Math.min(index, Math.max(0, candidates.length - 1));

  useEffect(() => setIndex(0), [mention?.query]);

  // 随内容自动增高
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
    const el = inputRef.current;
    const end = Math.min(caret, value.length);
    const insert = mentionText(b);
    const next = value.slice(0, mention.start) + insert + value.slice(end);
    pendingCaret.current = mention.start + insert.length;
    onChange(next);
    el?.focus();
  };

  const insertAt = () => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? value.length;
    const needSpace = pos > 0 && !/\s$/.test(value.slice(0, pos));
    const ins = needSpace ? " @" : "@";
    pendingCaret.current = pos + ins.length;
    onChange(value.slice(0, pos) + ins + value.slice(pos));
    el?.focus();
  };

  return (
    <div className="relative border-t border-line/70 bg-surface-warm/60 p-4">
      {menuOpen && <MentionMenu bots={candidates} index={active} onPick={pick} onHover={setIndex} />}
      <div className={cn(
        "muster-glass-2 rounded-[26px] border border-white/80 px-5 pb-3 pt-3.5 shadow-lift transition-shadow duration-200 focus-within:shadow-glow-coral",
        error && "ring-2 ring-danger/30",
      )}>
        <textarea
          ref={inputRef}
          rows={2}
          value={value}
          placeholder="和 Pip 说点什么… 输入 @ 可以直接指定成员"
          aria-label="给 Pip 的消息"
          onChange={(e) => {
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(null);
            onChange(e.target.value);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
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
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="block max-h-[200px] min-h-[56px] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-ink-faint"
        />
        <div className="mt-2 flex items-center gap-1.5">
          <Tooltip content="指定成员（@）">
            <button type="button" onClick={insertAt} aria-label="@ 提及成员" className="grid size-9 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas-deep hover:text-coral-deep focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:outline-none">
              <AtSign className="size-[18px]" />
            </button>
          </Tooltip>
          <button type="button" disabled title="附件（即将支持）" aria-label="添加附件" className="grid size-9 place-items-center rounded-full text-ink-faint opacity-60"><Paperclip className="size-[18px]" /></button>
          <button type="button" disabled title="语音（即将支持）" aria-label="语音输入" className="grid size-9 place-items-center rounded-full text-ink-faint opacity-60"><Mic className="size-[18px]" /></button>
          <div className={cn("ml-2 min-w-0 flex-1 truncate text-xs", error ? "text-danger" : "text-ink-faint")} role={error ? "alert" : undefined}>
            {error ?? (
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Enter</Kbd> 发送 <span aria-hidden>·</span> <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> 换行 <span aria-hidden>·</span> <Kbd>@</Kbd> 指定成员
              </span>
            )}
          </div>
          <Button variant="primary" size="md" onClick={onSend} disabled={!canSend} loading={sending} aria-label="发送" className="h-11 gap-2 px-5">
            {!sending && <Send className="size-[18px]" aria-hidden />}
            {sending ? "发送中" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}
