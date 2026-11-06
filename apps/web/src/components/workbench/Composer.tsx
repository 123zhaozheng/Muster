// 工作台输入框：忙碌时 插话 / 排队 / 打断 三态分段 + 快捷键；任务结束后变为“继续对话”。
//   忙碌：Enter=按所选模式发送（默认插话） Alt+Enter=排队  Ctrl/Cmd+Enter=打断并发送  Shift+Enter 换行
//   空闲：Enter 发送（继续对话）
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Clock,MessageSquareReply, Pause, Send, Sparkles, Zap } from "lucide-react";
import { Button, Kbd, cn } from "@muster/ui";
import { resolveSendMode, type SendMode } from "./logic";
import "./workbench.css";

export interface ComposerProps {
  botName: string;
  busy: boolean;
  /** 发送；成功 resolve 后输入框清空，reject 则保留文本。 */
  onSend: (text: string, mode: SendMode) => Promise<void>;
}

type BusyMode = "steer" | "queue" | "interrupt";
const MODES: { value: BusyMode; label: string; hint: string; keys: string; icon: typeof Send; active: string }[] = [
  { value: "steer", label: "插话", hint: "下一步生效，不中断", keys: "Enter", icon: MessageSquareReply, active: "bg-lavender-soft text-lavender-deep ring-lavender/40" },
  { value: "queue", label: "排队", hint: "等这一轮做完再处理", keys: "Alt+Enter", icon: Clock, active: "bg-sky-soft text-sky-deep ring-sky/40" },
  { value: "interrupt", label: "打断", hint: "立即停下并改做这件事", keys: "Ctrl+Enter", icon: Pause, active: "bg-danger-soft text-danger-deep ring-danger/40" },
];

export function Composer({ botName, busy, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<BusyMode>("steer");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim() === "";

  // 输入框随内容长高（最多 160px）。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  // 任务结束后回到默认模式。
  useEffect(() => {
    if (!busy) setMode("steer");
  }, [busy]);

  const send = async (m: SendMode) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(t, m);
      setText("");
      setMode("steer"); // 打断是一次性的，发完恢复为插话
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const resolved = resolveSendMode({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing }, busy);
    if (!resolved) return;
    e.preventDefault();
    void send(resolved === "steer" ? mode : resolved); // 纯 Enter 按当前选中的模式发
  };

  const current = MODES.find((m) => m.value === mode)!;
  const sendMode: SendMode = busy ? mode : "normal";

  return (
    <div className="border-t border-line/70 bg-gradient-to-b from-transparent to-canvas-deep/40 px-4 pb-3 pt-3">
      {busy ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div role="radiogroup" aria-label="发送方式" className="inline-flex gap-1 rounded-pill bg-canvas-deep p-1 shadow-[inset_0_1px_2px_rgb(60_40_20/0.06)]">
            {MODES.map((m) => {
              const on = m.value === mode;
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={m.label}
                  title={`${m.label}：${m.hint}（${m.keys}）`}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1 text-[13px] font-medium ring-1 ring-transparent transition-[background-color,color,box-shadow] duration-200 ease-muster",
                    on ? cn(m.active, "shadow-soft") : "text-ink-soft hover:text-ink",
                  )}
                >
                  <Icon size={13} aria-hidden />
                  <span aria-hidden>{m.label}</span>
                </button>
              );
            })}
          </div>
          <span className="text-xs text-ink-soft">{current.hint}</span>
        </div>
      ) : (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-ink-soft">
          <Sparkles size={13} className="text-coral" aria-hidden />
          任务已结束，继续对话会让 {botName} 接着上下文往下做
        </div>
      )}
      <div className={cn("flex items-end gap-2 rounded-3xl border bg-surface px-4 py-2 shadow-card transition-[border-color,box-shadow] duration-200 ease-muster focus-within:border-coral/50 focus-within:shadow-[0_0_0_4px_rgb(255_107_74/0.12),var(--shadow-card)]", error ? "border-danger/50" : "border-line")}>
        <span className={cn("mb-2 shrink-0", busy ? "text-lavender" : "text-coral")} aria-hidden>{busy ? <Zap size={18} /> : <Sparkles size={18} />}</span>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? `给${botName}插话…` : `继续和${botName}对话…`}
          aria-label={busy ? "插话内容" : "继续对话内容"}
          className="wb-scroll max-h-40 min-h-6 flex-1 resize-none bg-transparent py-1.5 text-sm leading-6 outline-none placeholder:text-ink-faint"
        />
        <Button variant="primary" aria-label="发送" className="mb-0.5 size-10 shrink-0 !px-0" disabled={empty} loading={sending} icon={<Send size={17} />} onClick={() => void send(sendMode)} />
      </div>
      {error && <div role="status" className="mt-1.5 px-2 text-xs text-danger">发送失败：{error}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px] text-ink-faint">
        {busy ? (
          <>
            <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>{current.label}</span>
            <span className="inline-flex items-center gap-1"><Kbd>Alt</Kbd>+<Kbd>Enter</Kbd>排队</span>
            <span className="inline-flex items-center gap-1"><Kbd>Ctrl/⌘</Kbd>+<Kbd>Enter</Kbd>打断并发送</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>发送</span>
        )}
        <span className="inline-flex items-center gap-1"><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>换行</span>
      </div>
    </div>
  );
}
