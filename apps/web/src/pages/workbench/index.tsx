// 工单详情 /task/:taskId：左侧与负责成员的对话和实际步骤，右栏是概况 / 方案 / 改动 / 终端 / 日志（≥1280 内嵌且可拖动左边缘调宽，更窄时用抽屉）。
// ?panel=<标签> 打开右栏并定位到该标签（旧的 /task/:id/branches 重定向到 ?panel=plans）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowDown, X } from "lucide-react";
import { Button, Drawer, DrawerContent, EmptyState, IconButton, toast } from "@muster/ui";
import { hubRequest, loadBranches, useEntries, useHub } from "../../lib/hub";
import { ResizeHandle, useResizableWidth } from "../../components/layout";
import { Composer } from "../../components/workbench/Composer";
import { EntryStream, WorkingNote } from "../../components/workbench/EntryView";
import { useAttempts } from "../../components/workbench/Attempts";
import { TaskPanel, type PanelTab } from "../../components/workbench/TaskPanel";
import { TaskSteps } from "../../components/workbench/TaskSteps";
import { WorkbenchHeader } from "../../components/workbench/WorkbenchHeader";
import { isBusy, type SendMode } from "../../components/workbench/logic";

/** 右侧面板内嵌所需的最小视口宽度；没有 matchMedia 的环境（jsdom）按宽屏处理。 */
const WIDE_PX = 1280;
/** 内嵌右侧面板宽度：持久化键、默认值与拖动范围（px）。 */
const TASK_PANEL_WIDTH = { storageKey: "muster.taskPanel.width", defaultWidth: 420, min: 260, max: 560 } as const;
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(`(min-width: ${WIDE_PX}px)`).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(min-width: ${WIDE_PX}px)`);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return wide;
}

export default function Workbench() {
  const { taskId = "" } = useParams();
  const [search] = useSearchParams();
  const task = useHub((s) => s.model.tasks[taskId]);
  const bot = useHub((s) => (task ? s.model.bots[task.botId] : undefined));
  const entries = useEntries(task?.threadId);
  const wide = useWide();
  const panelWidth = useResizableWidth(TASK_PANEL_WIDTH);

  const requested = search.get("panel") as PanelTab | null;
  const [tab, setTab] = useState<PanelTab | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [inlineOpen, setInlineOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [unread, setUnread] = useState(false);

  // ?panel=<标签>：打开右栏并定位（同一页面内点链接也会生效）。
  useEffect(() => {
    if (!requested) return;
    setTab(requested);
    if (wide) setInlineOpen(true);
    else setDrawerOpen(true);
    // 只响应链接变化；窗口宽度变化不重新打开面板。
  }, [requested]);

  // 拉取同一工单的全部尝试：右栏“方案”，以及在对话里标出“从这一步分出了 N 个分支”。
  const family = useAttempts(taskId);
  const rootTaskId = family.root?.id;
  useEffect(() => {
    if (rootTaskId) void loadBranches(rootTaskId).catch(() => {});
  }, [rootTaskId]);
  const branchCounts = useMemo(() => {
    const ids = new Set(entries.map((e) => e.id));
    const out: Record<string, number> = {};
    for (const b of family.attempts) if (ids.has(b.forkEntryId)) out[b.forkEntryId] = (out[b.forkEntryId] ?? 0) + 1;
    return out;
  }, [family.attempts, entries]);

  // 新消息 / 流式增量到来时，若已接近底部则跟随滚动；否则提示“有新消息”。
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const last = entries[entries.length - 1];
  const tailKey = `${entries.length}:${last && "text" in last ? last.text.length : 0}:${task?.status}`;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else setUnread(true);
  }, [tailKey]);

  const jumpToEntry = useCallback((entryId: string) => {
    stickRef.current = false;
    listRef.current?.querySelector(`[data-entry-id="${entryId}"]`)?.scrollIntoView?.({ block: "center" });
  }, []);

  if (!task) {
    return (
      <div className="px-5 py-8 md:px-8">
        <EmptyState
          pebble={{ shape: "round", color: "cream", status: "sleeping" }}
          title="未找到这个工单"
          description="它可能已被清理，或链接有误。"
          action={<Link to="/" className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">回到主线</Link>}
        />
      </div>
    );
  }

  const fail = (what: string) => (e: unknown) => setNotice(`${what}失败：${e instanceof Error ? e.message : String(e)}`);

  const send = async (text: string, mode: SendMode) => {
    await hubRequest("chat.send", { threadId: task.threadId, text, mode });
    stickRef.current = true;
  };
  const openPanel = (t: PanelTab) => {
    setTab(t);
    if (wide) setInlineOpen(true);
    else setDrawerOpen(true);
  };
  const fork = (entryId: string) => {
    if (forking) return;
    setForking(true);
    setNotice(null);
    hubRequest("task.fork", { taskId: task.id, entryId })
      .then(() => loadBranches(family.root?.id ?? task.id))
      .then(() => {
        toast.success("已新开一个尝试");
        openPanel("plans");
      })
      .catch(fail("创建分支"))
      .finally(() => setForking(false));
  };
  const cancel = async () => {
    try {
      await hubRequest("task.cancel", { taskId: task.id });
      toast.success("工单已取消");
    } catch (e) {
      fail("取消工单")(e);
      throw e; // 让确认框保持打开
    }
  };
  const openDiff = (path: string) => {
    setSelectedPath(path);
    openPanel("diff");
  };

  const busy = isBusy(task);
  const streaming = (last?.kind === "bot" || last?.kind === "thinking") && !!last.streaming;
  const panelOpen = wide ? inlineOpen : drawerOpen;
  const panel = (
    <TaskPanel task={task} bot={bot} entries={entries} root={family.root ?? task} attempts={family.attempts} tab={tab} onTab={setTab} selectedPath={selectedPath} onSelectPath={setSelectedPath} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchHeader
        task={task}
        bot={bot}
        onInterrupt={() => void hubRequest("task.interrupt", { taskId: task.id }).then(() => toast.info("已打断，等待成员响应")).catch(fail("打断"))}
        onCancel={cancel}
        panelOpen={panelOpen}
        onTogglePanel={() => (wide ? setInlineOpen((v) => !v) : setDrawerOpen((v) => !v))}
      />
      <div className="flex min-h-0 flex-1">
        <div className={`relative flex flex-1 flex-col ${wide && inlineOpen ? "min-w-[400px]" : "min-w-0"}`}>
          {notice && (
            <div role="alert" className="mx-5 mt-3 flex items-center gap-2 rounded-control bg-danger-surface px-3 py-2 text-caption text-danger md:mx-8">
              <span className="min-w-0 flex-1">{notice}</span>
              <IconButton label="关闭提示" size="sm" tooltip={false} onClick={() => setNotice(null)}>
                <X />
              </IconButton>
            </div>
          )}
          <TaskSteps entries={entries} onJump={jumpToEntry} />
          <div className="relative min-h-0 flex-1">
            <div
              ref={listRef}
              className="h-full overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                stickRef.current = near;
                setShowJump(!near);
                if (near) setUnread(false);
              }}
            >
              <div className="mx-auto w-full max-w-[760px] space-y-2 px-5 py-6 md:px-6">
                {entries.length === 0 && (
                  <EmptyState compact pebble={{ shape: bot?.shape ?? "round", color: bot?.color ?? "cream", status: busy ? "working" : "idle" }} title="还没有消息" description={`${bot?.name ?? "成员"}开始工作后，对话会出现在这里。`} />
                )}
                <EntryStream
                  entries={entries}
                  live={busy}
                  branchCounts={branchCounts}
                  forking={forking}
                  onFork={fork}
                  branchesHref={`/task/${task.id}?panel=plans`}
                  onOpenDiff={openDiff}
                  onChoose={(text) => void send(text, "normal").catch(fail("发送"))}
                />
                {busy && !streaming && <WorkingNote bot={bot} thinking={bot?.status === "thinking"} waitingApproval={task.status === "waiting_approval"} />}
              </div>
            </div>
            {showJump && (
              <Button
                size="sm"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-overlay"
                icon={<ArrowDown className="size-4" />}
                onClick={() => {
                  stickRef.current = true;
                  listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
                }}
              >
                {unread ? "有新消息" : "回到最新"}
              </Button>
            )}
          </div>
          <div className="shrink-0 px-5 pb-5 md:px-6">
            <div className="mx-auto w-full max-w-[760px]">
              <Composer
                botName={bot?.name ?? "成员"}
                busy={busy}
                idleHint={task.status === "queued" ? "工单正在排队" : undefined}
                onSend={send}
              />
            </div>
          </div>
        </div>
        {wide && inlineOpen && (
          <aside aria-label="产物与记录" style={{ width: panelWidth.width }} className="relative min-w-[260px] shrink border-l border-border bg-surface">
            <ResizeHandle label="调整产物面板宽度" edge="left" {...panelWidth.handleProps} />
            {panel}
          </aside>
        )}
      </div>
      {!wide && (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent title="产物与记录" width={460} bodyClassName="p-0">
            {panel}
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
