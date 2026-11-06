import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowDown } from "lucide-react";
import { MAIN_BOT_ID, MAIN_THREAD_ID, type Bot } from "@muster/protocol";
import { Button, Skeleton } from "@muster/ui";
import { MemberAvatar } from "../../components/common";
import { ChatHeader, ChatLayout, type ChatHeaderConversation } from "../../components/layout";
import { Composer } from "../../components/home/Composer";
import { NowPanel } from "../../components/home/NowPanel";
import { ModelHint, Starters } from "../../components/home/Starters";
import { ThinkingRow, Timeline } from "../../components/home/Timeline";
import { useServerNow } from "../../components/home/serverClock";
import { hubRequest, useEntries, useHub } from "../../lib/hub";
import { summarizeWork } from "../../lib/status";

/** 数据尚未到达时的占位 Pip。 */
const FALLBACK_PIP: Pick<Bot, "name" | "shape" | "color" | "status"> = { name: "Pip", shape: "round", color: "cream", status: "idle" };
/** 距底部多少像素以内算“跟随最新消息”。 */
const STICK_THRESHOLD = 80;
/** 头部 ⌄ 菜单里最多列几条最近的成员对话。 */
const RECENT_CONVERSATIONS = 5;

export default function HomePage() {
  const pipBot = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const pip = pipBot ?? FALLBACK_PIP;
  const connected = useHub((s) => s.status === "open");
  const hasModel = useHub((s) => !!(s.model.modelSettings?.router || s.model.modelSettings?.native));
  const tasks = useHub((s) => s.model.tasks);
  const approvals = useHub((s) => s.model.approvals);
  const bots = useHub((s) => s.model.bots);
  const entries = useEntries(MAIN_THREAD_ID);
  const now = useServerNow();
  const [params] = useSearchParams();
  const targetMsg = params.get("msg");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [away, setAway] = useState(false); // 用户滚离了底部
  const [unseen, setUnseen] = useState(false); // 滚离期间又来了新消息
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const scrolledToRef = useRef<string | null>(null);

  const summary = useMemo(() => summarizeWork(Object.values(tasks), Object.values(approvals)), [tasks, approvals]);
  // 最近的成员对话（按开始时间倒序），供头部 ⌄ 菜单切换
  const recent = useMemo<ChatHeaderConversation[]>(
    () =>
      Object.values(tasks)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, RECENT_CONVERSATIONS)
        .map((t) => {
          const bot = bots[t.botId];
          return { id: t.id, label: bot ? `${bot.name} · ${t.title}` : t.title, to: `/task/${t.id}`, lead: bot && <MemberAvatar bot={bot} size={20} /> };
        }),
    [tasks, bots],
  );
  const running = useMemo(() => Object.values(tasks).filter((t) => t.parentThreadId === MAIN_THREAD_ID && t.status === "running"), [tasks]);

  // 新消息（含流式增量）到达：停留在底部附近就跟随，否则提示“有新消息”
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [entries, pip.status]);

  // 从全局搜索跳来的 ?msg=<entryId>：滚到那条消息
  useEffect(() => {
    if (!targetMsg || scrolledToRef.current === targetMsg) return;
    const el = document.getElementById(`msg-${targetMsg}`);
    if (!el) return;
    scrolledToRef.current = targetMsg;
    stickRef.current = false;
    el.scrollIntoView?.({ block: "center" });
  }, [targetMsg, entries]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = near;
    setAway(!near);
    if (near) setUnseen(false);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAway(false);
    setUnseen(false);
    el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  };

  /** 把示例/选项文字填进输入框（多个选项以“，”连接），让用户修改后再发。 */
  const fill = useCallback((text: string, append: boolean) => {
    setDraft((cur) => (append && cur.trim() ? (cur.includes(text) ? cur : `${cur.trimEnd()}，${text}`) : text));
    inputRef.current?.focus();
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    stickRef.current = true;
    try {
      await hubRequest("chat.send", { threadId: MAIN_THREAD_ID, text });
    } catch (e) {
      setDraft(text);
      setError(`发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await Promise.all(running.map((t) => hubRequest("task.interrupt", { taskId: t.id })));
    } catch (e) {
      setError(`停止失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const last = entries[entries.length - 1];
  const empty = connected && entries.length === 0;
  const thinking = pip.status === "thinking" && !(last?.kind === "bot" && last.streaming);

  return (
    <ChatLayout
      header={<ChatHeader title={pip.name} conversations={recent} status={summary} panelToggle />}
      footer={
        <div className="relative">
          {away && (
            <Button variant="secondary" size="sm" icon={<ArrowDown className="size-4" />} onClick={jumpToLatest} className="absolute bottom-full left-1/2 mb-3 -translate-x-1/2 shadow-overlay">
              {unseen ? "有新消息" : "回到最新"}
            </Button>
          )}
          {empty && <Starters className="mb-5" onPick={(t) => fill(t, false)} />}
          <Composer value={draft} onChange={setDraft} onSend={() => void send()} inputRef={inputRef} sending={sending} error={error} running={running.length} onStop={() => void stop()} />
        </div>
      }
      panel={<NowPanel now={now} />}
      panelTitle="此刻"
      scrollRef={scrollRef}
      onScroll={onScroll}
    >
      <div className="flex flex-col gap-6">
        {connected && !hasModel && <ModelHint />}
        {entries.length > 0 ? (
          <>
            <Timeline entries={entries} now={now} onPick={(t) => fill(t, true)} />
            {thinking && <ThinkingRow />}
          </>
        ) : connected ? null : (
          <div className="flex flex-col gap-4" role="status" aria-label="正在连接守护进程">
            <div className="flex items-start gap-3"><Skeleton circle className="size-8" /><Skeleton className="h-14 w-2/3" /></div>
            <div className="flex justify-end"><Skeleton className="h-10 w-1/2" /></div>
            <div className="text-center text-sm text-fg-3">正在连接守护进程…</div>
          </div>
        )}
      </div>
    </ChatLayout>
  );
}
