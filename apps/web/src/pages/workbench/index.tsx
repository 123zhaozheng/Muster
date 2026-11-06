// 子 Bot 工作台 /task/:taskId（对照 design/mockups/02-workbench.png）
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowDown } from "lucide-react";
import { Card, Empty, toast } from "@muster/ui";
import { hubRequest, loadBranches, useEntries, useHub } from "../../lib/hub";
import { Page } from "../../components/layout";
import { Composer } from "../../components/workbench/Composer";
import { EntryView, TypingIndicator } from "../../components/workbench/EntryView";
import { RightPanel, type RightTab } from "../../components/workbench/RightPanel";
import { WorkbenchHeader } from "../../components/workbench/WorkbenchHeader";
import { isBusy, type SendMode } from "../../components/workbench/logic";
import "../../components/workbench/workbench.css";

export default function Workbench() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const task = useHub((s) => s.model.tasks[taskId]);
  const bot = useHub((s) => (task ? s.model.bots[task.botId] : undefined));
  const branches = useHub((s) => s.model.branches);
  const entries = useEntries(task?.threadId);

  const [tab, setTab] = useState<RightTab>("diff");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);

  // 拉取分支，用于在对话里标出“从这一步分出了 N 个分支”。
  const rootTaskId = task ? (task.forkedFrom?.taskId ?? task.id) : undefined;
  useEffect(() => {
    if (rootTaskId) void loadBranches(rootTaskId).catch(() => {});
  }, [rootTaskId]);
  const branchCounts = useMemo(() => {
    const ids = new Set(entries.map((e) => e.id));
    const out: Record<string, number> = {};
    for (const b of Object.values(branches)) if (ids.has(b.forkEntryId)) out[b.forkEntryId] = (out[b.forkEntryId] ?? 0) + 1;
    return out;
  }, [branches, entries]);

  // 新消息 / 流式增量到来时，若已接近底部则跟随滚动。
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const last = entries[entries.length - 1];
  const tailKey = `${entries.length}:${last && "text" in last ? last.text.length : 0}:${task?.status}`;
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  if (!task) {
    return (
      <Page>
        <Empty
          pebble={{ shape: "round", color: "cream", status: "sleeping" }}
          title="未找到这个任务"
          description="它可能已被清理，或链接有误。"
          action={<Link to="/" className="inline-flex h-10 items-center rounded-pill bg-coral-soft px-5 text-sm font-medium text-coral-deep transition-colors hover:bg-coral-soft/70">回到主线</Link>}
        />
      </Page>
    );
  }

  const fail = (what: string) => (e: unknown) => setNotice(`${what}失败：${e instanceof Error ? e.message : String(e)}`);

  const send = async (text: string, mode: SendMode) => {
    await hubRequest("chat.send", { threadId: task.threadId, text, mode });
    stickRef.current = true;
  };
  const fork = (entryId: string) => {
    if (forking) return;
    setForking(true);
    setNotice(null);
    hubRequest("task.fork", { taskId: task.id, entryId })
      .then(() => {
        toast.success("已创建分支");
        navigate(`/task/${task.id}/branches`); // 分支页可对比，并可“继续这个分支”进入新任务
      })
      .catch(fail("创建分支"))
      .finally(() => setForking(false));
  };
  const cancel = async () => {
    try {
      await hubRequest("task.cancel", { taskId: task.id });
      toast.success("任务已取消");
    } catch (e) {
      fail("取消任务")(e);
      throw e; // 让确认框保持打开
    }
  };

  const busy = isBusy(task);
  const streaming = last?.kind === "bot" && !!last.streaming;

  return (
    <Page fill noGlow={false} className="gap-4 xl:h-[calc(100dvh-56px)] xl:min-h-[640px]">
      <WorkbenchHeader
        task={task}
        bot={bot}
        onInterrupt={() => void hubRequest("task.interrupt", { taskId: task.id }).then(() => toast.info("已打断，等待 Bot 响应")).catch(fail("打断"))}
        onCancel={cancel}
      />
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card frosted className="relative flex h-[72dvh] min-h-[460px] min-w-0 flex-col overflow-hidden xl:h-auto xl:min-h-0">
          {notice && (
            <div role="alert" className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
              <span className="flex-1">{notice}</span>
              <button type="button" aria-label="关闭提示" className="cursor-pointer rounded px-1 hover:bg-danger/10" onClick={() => setNotice(null)}>×</button>
            </div>
          )}
          <div
            ref={listRef}
            className="wb-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-4"
            onScroll={(e) => {
              const el = e.currentTarget;
              const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              stickRef.current = near;
              setShowJump(!near);
            }}
          >
            {entries.length === 0 && (
              <Empty compact pebble={{ shape: bot?.shape ?? "round", color: bot?.color ?? "cream", status: busy ? "working" : "idle" }} title="还没有消息" description={`${bot?.name ?? "Bot"}开始工作后，对话会出现在这里。`} />
            )}
            {entries.map((e) => (
              <EntryView
                key={e.id}
                entry={e}
                forking={forking}
                onFork={fork}
                branchCount={branchCounts[e.id]}
                branchesHref={`/task/${task.id}/branches`}
                onOpenDiff={(path) => {
                  setSelectedPath(path);
                  setTab("diff");
                }}
                onChoose={(text) => void send(text, "normal").catch(fail("发送"))}
              />
            ))}
            {busy && !streaming && <TypingIndicator bot={bot} thinking={bot?.status === "thinking"} waitingApproval={task.status === "waiting_approval"} />}
          </div>
          {showJump && (
            <button
              type="button"
              onClick={() => {
                const el = listRef.current;
                if (el) el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
              }}
              className="wb-in absolute bottom-[132px] left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface/95 px-3 py-1.5 text-xs font-medium text-ink-soft shadow-lift backdrop-blur transition-colors hover:text-coral-deep"
            >
              <ArrowDown size={13} />
              回到最新
            </button>
          )}
          <Composer botName={bot?.name ?? "Bot"} busy={busy} onSend={send} />
        </Card>
        <Card frosted className="h-[560px] min-w-0 overflow-hidden xl:h-auto xl:min-h-0">
          <RightPanel task={task} bot={bot} entries={entries} tab={tab} onTab={setTab} selectedPath={selectedPath} onSelectPath={setSelectedPath} />
        </Card>
      </div>
    </Page>
  );
}
