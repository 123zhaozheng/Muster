// 任务输入框：任务进行中是“补充要求”，插话 / 排队 / 打断三选一；任务结束后变为“继续对话”。
// 发送方式随“设置 · 通用 · 发送方式”：
//   Enter 发送      进行中：Enter=按所选方式发送（默认插话）  Alt/⌥+Enter=排队  Ctrl/⌘+Enter=打断并发送；已结束：Enter 发送
//   Ctrl+Enter 发送 进行中：Ctrl/⌘+Enter=按所选方式发送  Alt/⌥+Enter=排队；已结束：Ctrl/⌘+Enter 发送；Enter 换行
//   Shift+Enter 始终换行，输入法组字中不发送
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useParams } from "react-router";
import { ArrowUp } from "lucide-react";
import { Button, Kbd, Segmented } from "@muster/ui";
import { ApprovalDock } from "../approvals/ApprovalDock";
import { useSendKey, type SendKey } from "../../lib/preferences";
import { isMac, modLabel } from "../../shell/keys";
import { resolveSendMode, type SendMode } from "./logic";

type KeyLike = Parameters<typeof resolveSendMode>[0];

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 240;

/** 在发送方式偏好下解析按键；"steer" 表示“按当前选中的方式发”。 */
function resolveKey(e: KeyLike, busy: boolean, sendKey: SendKey): SendMode | null {
  const resolved = resolveSendMode(e, busy);
  if (!resolved || sendKey === "enter") return resolved;
  if (e.ctrlKey || e.metaKey) return busy ? "steer" : "normal";
  if (busy && e.altKey) return "queue";
  return null; // 纯 Enter 换行
}

interface ComposerProps {
  botName: string;
  busy: boolean;
  /** 非进行中时的提示；默认是“任务已结束…”。 */
  idleHint?: string;
  /** 这条对话所属的工单：它的待确认请求停靠在输入框上方。默认取路由参数 :taskId。 */
  taskId?: string;
  /** 发送；成功 resolve 后输入框清空，reject 则保留文本。 */
  onSend: (text: string, mode: SendMode) => Promise<void>;
}

type BusyMode = "steer" | "queue" | "interrupt";
const MODES: { value: BusyMode; label: string; hint: string }[] = [
  { value: "steer", label: "插话", hint: "下一步生效，不中断" },
  { value: "queue", label: "排队", hint: "等这一轮做完再处理" },
  { value: "interrupt", label: "打断", hint: "立即停下并改做这件事" },
];

export function Composer({ botName, busy, idleHint, taskId: taskIdProp, onSend }: ComposerProps) {
  const params = useParams();
  const taskId = taskIdProp ?? params.taskId;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<BusyMode>("steer");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sendKey = useSendKey();
  const empty = text.trim() === "";

  // 输入框随内容长高，到上限后框内滚动。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);
  // 任务结束后回到默认方式。
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
    const resolved = resolveKey({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, busy, sendKey);
    if (!resolved) return;
    e.preventDefault();
    void send(resolved === "steer" ? mode : resolved); // 纯 Enter 按当前选中的方式发
  };

  const current = MODES.find((m) => m.value === mode)!;
  const sendMode: SendMode = busy ? mode : "normal";
  const mod = modLabel();
  const alt = isMac() ? "⌥" : "Alt";

  const hints = sendKey === "ctrl-enter" ? (
    <>
      <span className="inline-flex items-center gap-1"><Kbd>{mod}</Kbd>+<Kbd>Enter</Kbd>{busy ? current.label : "发送"}</span>
      {busy && <span className="inline-flex items-center gap-1"><Kbd>{alt}</Kbd>+<Kbd>Enter</Kbd>排队</span>}
      <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>换行</span>
    </>
  ) : (
    <>
      {busy ? (
        <>
          <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>{current.label}</span>
          <span className="inline-flex items-center gap-1"><Kbd>{alt}</Kbd>+<Kbd>Enter</Kbd>排队</span>
          <span className="inline-flex items-center gap-1"><Kbd>{mod}</Kbd>+<Kbd>Enter</Kbd>打断并发送</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>发送</span>
      )}
      <span className="inline-flex items-center gap-1"><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>换行</span>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {taskId && <ApprovalDock taskId={taskId} />}
      <div className="rounded-composer border border-border bg-surface px-3 pb-2 pt-3 transition-colors focus-within:border-accent">
        <textarea
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? `给${botName}插话…` : `继续和${botName}对话…`}
          aria-label={busy ? "补充要求" : "继续对话内容"}
          className="block min-h-[48px] max-h-[240px] w-full resize-none bg-transparent px-1 text-body text-fg outline-none placeholder:text-fg-3"
        />
        <div className="mt-1 flex items-center gap-2">
          {busy && <Segmented value={mode} onChange={setMode} options={MODES.map(({ value, label }) => ({ value, label }))} />}
          <div className="flex-1" />
          <Button variant="primary" aria-label="发送" className="size-8 shrink-0 rounded-full !px-0" disabled={empty} loading={sending} icon={<ArrowUp className="size-4" />} onClick={() => void send(sendMode)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs text-fg-3">
        {error ? (
          <span role="status" className="min-w-0 flex-1 text-danger">发送失败：{error}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{busy ? current.hint : (idleHint ?? `任务已结束，继续对话会让${botName}接着上下文往下做`)}</span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{hints}</span>
      </div>
    </div>
  );
}
