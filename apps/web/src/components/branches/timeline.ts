// 分支树的数据准备：主路线节点选取 + 布局坐标（纯函数，不依赖 React Flow）。
import type { Branch, Entry } from "@muster/protocol";
import { entrySummary } from "../workbench/logic";

export interface TimelineStep {
  entryId: string;
  index: number; // 1-based 序号
  label: string;
  /** 悬停时显示的一句话摘要。 */
  summary: string;
  icon: "doc" | "search" | "code" | "play" | "branch" | "chat" | "user" | "alert";
}

const MAX_STEPS = 8;
const KEY_KINDS = new Set<Entry["kind"]>(["tool_summary", "diff", "test_result", "steer", "approval"]);

function describe(e: Entry): Pick<TimelineStep, "label" | "icon"> {
  switch (e.kind) {
    case "user": return { label: "需求", icon: "user" };
    case "steer": return { label: "插话", icon: "chat" };
    case "bot": return { label: "回复", icon: "doc" };
    case "tool_summary": return e.edits > 0 ? { label: "编写代码", icon: "code" } : e.commands > 0 && e.reads === 0 ? { label: "运行命令", icon: "play" } : { label: "调研方案", icon: "search" };
    case "diff": return { label: "代码改动", icon: "code" };
    case "test_result": return { label: "运行测试", icon: "play" };
    case "approval": return { label: "审批", icon: "alert" };
    case "dispatch": return { label: "派发", icon: "branch" };
    case "choices": return { label: "选择", icon: "chat" };
    case "system": return { label: "系统", icon: "doc" };
  }
}

/**
 * 从主路线 thread 的 entries 里挑出关键节点（最多 8 个）。
 * fork 点一定保留；超出时优先保留工具/改动/测试/插话/审批，再均匀抽样。
 */
export function buildTimeline(entries: Entry[], forkEntryIds: ReadonlySet<string>): TimelineStep[] {
  let picked = entries.filter((e) => e.kind !== "system");
  const must = (e: Entry) => forkEntryIds.has(e.id);
  if (picked.length > MAX_STEPS) picked = picked.filter((e) => must(e) || KEY_KINDS.has(e.kind));
  if (picked.length > MAX_STEPS) {
    const forced = new Set(picked.filter(must));
    const rest = picked.filter((e) => !forced.has(e));
    const room = Math.max(0, MAX_STEPS - forced.size);
    const keep = new Set<Entry>(forced);
    for (let i = 0; i < room; i++) keep.add(rest[Math.round((i * (rest.length - 1)) / Math.max(1, room - 1))]!);
    picked = picked.filter((e) => keep.has(e));
  }
  return picked.map((e, i) => ({ entryId: e.id, index: i + 1, summary: entrySummary(e), ...describe(e) }));
}

/** 不同分支的柔和配色（CSS 变量来自 @muster/ui 的 token）。 */
export const BRANCH_TONES = [
  { stroke: "var(--color-mint)", soft: "var(--color-mint-soft)" },
  { stroke: "var(--color-lavender)", soft: "var(--color-lavender-soft)" },
  { stroke: "var(--color-sky)", soft: "var(--color-sky-soft)" },
  { stroke: "var(--color-amber)", soft: "var(--color-amber-soft)" },
  { stroke: "var(--color-coral)", soft: "var(--color-coral-soft)" },
] as const;
export const toneOf = (i: number) => BRANCH_TONES[i % BRANCH_TONES.length]!;

export const STEP_GAP = 130;
export const MAIN_Y = 160;
export const BRANCH_DY = 130;

export interface BranchPlacement {
  branch: Branch;
  /** 分支从哪个主路线节点分出（找不到 fork entry 时挂在最后一个节点）。 */
  fromEntryId: string | null;
  x: number;
  y: number;
}

/** 分支头位置：在 fork 节点右侧，上下交替散开。 */
export function placeBranches(steps: TimelineStep[], branches: Branch[]): BranchPlacement[] {
  const xOf = (entryId: string | null) => {
    const i = steps.findIndex((s) => s.entryId === entryId);
    return (i < 0 ? steps.length : i + 1) * STEP_GAP; // 0 号位是起点 Pip
  };
  const perFork = new Map<string, number>();
  return branches.map((branch) => {
    const known = steps.some((s) => s.entryId === branch.forkEntryId);
    const fromEntryId = known ? branch.forkEntryId : (steps[steps.length - 1]?.entryId ?? null);
    const key = fromEntryId ?? "";
    const n = perFork.get(key) ?? 0;
    perFork.set(key, n + 1);
    const dir = n % 2 === 0 ? -1 : 1;
    const level = 1 + Math.floor(n / 2);
    return { branch, fromEntryId, x: xOf(fromEntryId) + STEP_GAP, y: MAIN_Y + dir * level * BRANCH_DY };
  });
}
