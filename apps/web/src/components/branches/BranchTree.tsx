// 分支页上半区：横向时间线树（@xyflow/react，只读不可拖拽）。
// 节点卡片化；当前路线高亮；悬停显示该步摘要；已采用的分支带金色标记；运行中的分支连线流动。
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crown } from "lucide-react";
import type { Bot, Branch, Entry } from "@muster/protocol";
import { Pebble, cn } from "@muster/ui";
import { IconAlert, IconBranch, IconChat, IconCode, IconFile, IconPlay, IconSearch, IconUser } from "../workbench/icons";
import "../workbench/workbench.css";
import { MAIN_Y, STEP_GAP, buildTimeline, placeBranches, toneOf, type TimelineStep } from "./timeline";

const ICONS = { doc: IconFile, search: IconSearch, code: IconCode, play: IconPlay, branch: IconBranch, chat: IconChat, user: IconUser, alert: IconAlert } as const;
const GOLD = "#e9a82b";
const GOLD_SOFT = "#fff3d1";

// 把 handle 压成圆心处的 1px 点，让连线穿过节点中心（节点盖在连线上方）。
const dot = (left: number, top: number): CSSProperties => ({ left, top, right: "auto", bottom: "auto", width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: 0, transform: "none" });

type TreeBot = Pick<Bot, "shape" | "color" | "status" | "name">;
type StartData = { bot: TreeBot };
type StepData = { step: TimelineStep; onRoute: boolean; forkCount: number };
type HeadData = { bot: TreeBot | undefined; branch: Branch; stroke: string; soft: string; current: boolean };

/** 悬停浮层：用 CSS group-hover，不引入状态。 */
function HoverTip({ title, children, below }: { title: string; children: string; below?: boolean }) {
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-1/2 z-50 w-56 -translate-x-1/2 translate-y-1 rounded-xl border border-line bg-surface/95 px-3 py-2 text-left opacity-0 shadow-pop backdrop-blur transition-[opacity,transform] duration-200 ease-muster group-hover:translate-y-0 group-hover:opacity-100",
        below ? "top-full mt-2" : "bottom-full mb-2",
      )}
    >
      <div className="text-xs font-semibold text-ink">{title}</div>
      <div className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}

function StartNode({ data }: NodeProps<Node<StartData>>) {
  return (
    <div className="flex w-[70px] flex-col items-center gap-1.5">
      <Pebble shape={data.bot.shape} color={data.bot.color} status={data.bot.status} size={56} halo title={data.bot.name} />
      <span className="rounded-pill bg-surface/90 px-2.5 py-0.5 text-xs font-medium shadow-card">{data.bot.name}</span>
      <Handle type="source" position={Position.Right} style={dot(35, 28)} isConnectable={false} />
    </div>
  );
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { step, onRoute, forkCount } = data;
  const Icon = ICONS[step.icon];
  return (
    <div
      tabIndex={0}
      aria-label={`第 ${step.index} 步：${step.label}。${step.summary}`}
      className={cn(
        "group relative flex w-[108px] cursor-default flex-col items-center rounded-2xl border bg-surface/95 px-2 pb-2 pt-2.5 shadow-soft outline-none transition-[transform,box-shadow,border-color] duration-200 ease-muster hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-coral/50",
        onRoute ? "border-coral/50" : "border-line opacity-80",
      )}
    >
      <span className={cn("absolute -left-2 -top-2 grid size-5 place-items-center rounded-full text-[11px] font-semibold text-white shadow-soft", onRoute ? "muster-gradient-brand" : "bg-ink-faint")}>{step.index}</span>
      {forkCount > 0 && (
        <span title={`从这里分出 ${forkCount} 个分支`} className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-lavender text-white shadow-soft">
          <IconBranch size={11} />
        </span>
      )}
      <span className={cn("grid size-10 place-items-center rounded-xl", onRoute ? "bg-coral-soft text-coral-deep" : "bg-canvas-deep text-ink-soft")}>
        <Icon size={22} />
      </span>
      <span className="mt-1.5 text-xs font-medium text-ink">{step.label}</span>
      <HoverTip title={`${step.index}. ${step.label}`}>{step.summary || "（无摘要）"}</HoverTip>
      <Handle type="target" position={Position.Left} style={dot(54, 30)} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={dot(54, 30)} isConnectable={false} />
    </div>
  );
}

function HeadNode({ data }: NodeProps<Node<HeadData>>) {
  const { branch, bot, stroke, soft, current } = data;
  const adopted = !!branch.adopted;
  const t = branch.tests;
  const pass = !!t && t.failed === 0 && t.passed > 0;
  return (
    <div tabIndex={0} aria-label={`${branch.label}：${branch.summary}`} className="group relative flex items-start gap-3 outline-none">
      <div className="flex w-14 flex-col items-center gap-1">
        <div className="relative rounded-full" style={adopted ? { boxShadow: `0 0 0 3px ${GOLD}, 0 0 18px ${GOLD}66` } : current ? { boxShadow: `0 0 0 3px ${stroke}` } : undefined}>
          {bot ? <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={56} lite title={bot.name} /> : <span className="block size-14" />}
          {adopted && (
            <span className="absolute -right-1.5 -top-2 grid size-6 place-items-center rounded-full text-white shadow-soft" style={{ background: GOLD }} title="已采用">
              <Crown size={13} />
            </span>
          )}
        </div>
        <span className="whitespace-nowrap rounded-pill bg-surface/90 px-2 py-0.5 text-xs shadow-card">{bot?.name ?? "Bot"}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        <span
          className="whitespace-nowrap rounded-pill px-4 py-2 text-sm font-semibold shadow-soft transition-transform duration-200 ease-muster group-hover:-translate-y-0.5"
          style={{ background: adopted ? GOLD_SOFT : soft, color: "var(--color-ink)", border: `1.5px solid ${adopted ? GOLD : stroke}` }}
        >
          {branch.label}
        </span>
        <span className="flex gap-1 pl-1">
          {adopted && <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: GOLD }}>已采用</span>}
          {current && !adopted && <span className="rounded-pill bg-coral px-2 py-0.5 text-[11px] font-semibold text-white">当前</span>}
          {pass && <span className="rounded-pill bg-mint-soft px-2 py-0.5 text-[11px] font-semibold text-mint-deep">测试通过</span>}
          {!!t && t.failed > 0 && <span className="rounded-pill bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger-deep">{t.failed} 个失败</span>}
        </span>
      </div>
      <HoverTip title={branch.label} below>{branch.summary}</HoverTip>
      <Handle type="target" position={Position.Left} style={dot(28, 28)} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { start: StartNode, step: StepNode, head: HeadNode };

/** 容器宽度变化时重新适配视图。 */
function AutoFit({ watch }: { watch: React.RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = watch.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => void fitView({ padding: 0.1, duration: 0 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [watch, fitView]);
  return null;
}

export interface BranchTreeProps {
  /** 主路线（根任务）的 entries。 */
  entries: Entry[];
  branches: Branch[];
  rootBot: TreeBot | undefined;
  /** 分支头像用的 bot（状态已按分支任务换算）。 */
  botOf: (branch: Branch) => TreeBot | undefined;
  /** 用户当前所在的任务：该任务所在的路线会被高亮（根任务 = 整条主路线）。 */
  currentTaskId?: string;
  /** 正在运行的任务：其分支连线会流动。 */
  liveTaskIds?: ReadonlySet<string>;
}

export function BranchTree({ entries, branches, rootBot, botOf, currentTaskId, liveTaskIds }: BranchTreeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { nodes, edges } = useMemo(() => {
    const steps = buildTimeline(entries, new Set(branches.map((b) => b.forkEntryId)));
    const placements = placeBranches(steps, branches);
    const currentBranch = branches.find((b) => b.taskId === currentTaskId);
    // 当前路线：在分支上 = 主路线到分叉点 + 该分支；在根任务上 = 整条主路线。
    const forkIdx = currentBranch ? steps.findIndex((s) => s.entryId === placements.find((p) => p.branch.id === currentBranch.id)?.fromEntryId) : steps.length - 1;
    const routeEnd = currentBranch && forkIdx < 0 ? steps.length - 1 : forkIdx;
    const forkCounts = new Map<string, number>();
    placements.forEach((p) => p.fromEntryId && forkCounts.set(p.fromEntryId, (forkCounts.get(p.fromEntryId) ?? 0) + 1));

    const nodes: Node[] = [{ id: "start", type: "start", position: { x: -35, y: MAIN_Y - 28 }, data: { bot: rootBot ?? { name: "主线", shape: "round", color: "cream", status: "idle" } } satisfies StartData, draggable: false }];
    const edges: Edge[] = [];
    const grey = { stroke: "var(--color-ink-faint)", strokeWidth: 3, strokeLinecap: "round", opacity: 0.55 } as const;
    const hot = { stroke: "var(--color-coral)", strokeWidth: 4, strokeLinecap: "round" } as const;
    let prev = "start";
    steps.forEach((s, i) => {
      const id = `s-${s.entryId}`;
      const onRoute = i <= routeEnd;
      nodes.push({ id, type: "step", position: { x: (i + 1) * STEP_GAP - 54, y: MAIN_Y - 30 }, data: { step: s, onRoute, forkCount: forkCounts.get(s.entryId) ?? 0 } satisfies StepData, draggable: false });
      edges.push({ id: `m-${prev}-${id}`, source: prev, target: id, type: "straight", style: onRoute ? hot : grey, animated: onRoute && !currentBranch && !!currentTaskId && !!liveTaskIds?.has(currentTaskId) && i === steps.length - 1 });
      prev = id;
    });
    placements.forEach((p, i) => {
      const tone = toneOf(i);
      const id = `b-${p.branch.id}`;
      const current = p.branch.taskId === currentTaskId;
      const adopted = !!p.branch.adopted;
      const color = adopted ? GOLD : current ? "var(--color-coral)" : tone.stroke;
      nodes.push({ id, type: "head", position: { x: p.x - 28, y: p.y - 28 }, data: { bot: botOf(p.branch), branch: p.branch, stroke: tone.stroke, soft: tone.soft, current } satisfies HeadData, draggable: false });
      edges.push({
        id: `e-${id}`,
        source: p.fromEntryId ? `s-${p.fromEntryId}` : "start",
        target: id,
        type: "default",
        animated: !!liveTaskIds?.has(p.branch.taskId),
        style: { stroke: color, strokeWidth: adopted || current ? 4.5 : 3, strokeLinecap: "round", opacity: currentBranch && !current && !adopted ? 0.6 : 1 },
      });
    });
    return { nodes, edges };
  }, [entries, branches, rootBot, botOf, currentTaskId, liveTaskIds]);

  return (
    <div ref={wrapRef} className="relative h-[400px] w-full overflow-hidden rounded-card-lg muster-glass-2 bg-gradient-to-br from-coral-soft/40 via-surface-warm to-lavender-soft/50" data-testid="branch-tree">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.2}
          maxZoom={1.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        />
        <AutoFit watch={wrapRef} />
      </ReactFlowProvider>
      <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-3 rounded-pill bg-surface/80 px-3 py-1.5 text-[11px] text-ink-soft shadow-soft backdrop-blur">
        <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-coral" />当前路线</span>
        <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-ink-faint/60" />其他步骤</span>
        <span className="flex items-center gap-1.5"><Crown size={12} style={{ color: GOLD }} />已采用</span>
      </div>
    </div>
  );
}
