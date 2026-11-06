import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { MAIN_BOT_ID, MAIN_THREAD_ID, type Bot } from "@muster/protocol";
import { Button, Card, Pebble, Skeleton, StatusPill } from "@muster/ui";
import { Page, PageBody } from "../../components/layout";
import { hubRequest, useEntries, useHub } from "../../lib/hub";
import { Composer } from "../../components/home/Composer";
import { Hero } from "../../components/home/Hero";
import { RightRail } from "../../components/home/RightRail";
import { ThinkingRow, Timeline } from "../../components/home/Timeline";
import { useServerNow } from "../../components/home/serverClock";
import { ModelSetupCard, Welcome } from "../../components/home/Welcome";

/** 数据尚未到达时的占位 Pip。 */
const FALLBACK_PIP: Pick<Bot, "name" | "shape" | "color" | "status"> = { name: "Pip", shape: "round", color: "cream", status: "idle" };
/** 距底部多少像素以内算“跟随最新消息”。 */
const STICK_THRESHOLD = 80;

export default function HomePage() {
  const pipBot = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const pip = pipBot ?? FALLBACK_PIP;
  const connected = useHub((s) => s.status === "open");
  const hasModel = useHub((s) => !!(s.model.modelSettings?.router || s.model.modelSettings?.native));
  const entries = useEntries(MAIN_THREAD_ID);
  const now = useServerNow();

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [away, setAway] = useState(false); // 用户滚离了底部
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // 新消息（含流式增量）到达时，只在用户停留在底部附近才自动滚动
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, pip.status]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = near;
    setAway(!near);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAway(false);
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

  const last = entries[entries.length - 1];
  const thinking = pip.status === "thinking" && !(last?.kind === "bot" && last.streaming);

  return (
    <Page>
      <Hero pip={pip} now={now} />
      <PageBody
        main={
          <Card frosted className="flex h-[clamp(560px,calc(100dvh-300px),900px)] flex-col overflow-hidden p-0" role="region" aria-label="主线对话">
            <div className="flex items-center gap-3 border-b border-line/70 px-5 py-3">
              <Pebble shape={pip.shape} color={pip.color} status={pip.status} size={30} lite interactive={false} />
              <h2 className="text-[17px] font-semibold leading-6">主线对话</h2>
              <StatusPill status={pip.status} />
              <span className="ml-auto hidden text-xs text-ink-faint sm:block">{pip.name} 只负责理解与分发，具体的活儿交给成员</span>
            </div>
            <div className="relative min-h-0 flex-1">
              <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-5 py-5 md:px-8" data-testid="home-scroll">
                {entries.length > 0 ? (
                  <div className="flex flex-col gap-5">
                    {connected && !hasModel && <ModelSetupCard compact />}
                    <Timeline entries={entries} now={now} onPick={(t) => fill(t, true)} />
                    {thinking && <ThinkingRow botId={MAIN_BOT_ID} />}
                  </div>
                ) : connected ? (
                  <Welcome bot={pip} onPick={(t) => fill(t, false)} needsModel={!hasModel} />
                ) : (
                  <div className="flex flex-col gap-5 py-4" role="status" aria-label="正在连接守护进程">
                    <div className="flex items-start gap-3"><Skeleton circle className="size-11" /><Skeleton className="h-16 w-2/3" /></div>
                    <div className="flex items-start justify-end gap-3"><Skeleton className="h-12 w-1/2" /><Skeleton circle className="size-11" /></div>
                    <div className="text-center text-sm text-ink-faint">正在连接守护进程…</div>
                  </div>
                )}
              </div>
              {away && (
                <Button variant="outline" size="sm" icon={<ArrowDown className="size-4" />} onClick={jumpToLatest} className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lift">
                  回到最新
                </Button>
              )}
            </div>
            <Composer value={draft} onChange={setDraft} onSend={() => void send()} inputRef={inputRef} sending={sending} error={error} />
          </Card>
        }
        rail={<RightRail now={now} />}
      />
    </Page>
  );
}
