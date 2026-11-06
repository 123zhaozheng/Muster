// OWNER: U2. 导航单一数据源：侧栏分组、命令面板“页面”、面包屑标题都从这里来。
import type { ReactNode } from "react";
import { Bell, Brain, CalendarDays, House, Monitor, Settings, Users, Wallet, Zap } from "lucide-react";
import type { Task } from "@muster/protocol";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** NavLink end 匹配（主线 "/" 必须精确）。 */
  end?: boolean;
  /** 命令面板搜索关键词（小写）。 */
  keywords: string;
}

const ico = 20;

export const NAV_GROUPS: Array<{ id: string; label: string; items: NavItem[] }> = [
  {
    id: "main",
    label: "工作",
    items: [
      { to: "/", label: "主线", icon: <House size={ico} />, end: true, keywords: "home pip chat 首页 对话 主页" },
      { to: "/crew", label: "团队", icon: <Users size={ico} />, keywords: "crew team bot 成员 子agent" },
      { to: "/events", label: "事件", icon: <CalendarDays size={ico} />, keywords: "events trigger 触发器 定时 日程" },
      { to: "/devices", label: "设备", icon: <Monitor size={ico} />, keywords: "devices 电脑 配对" },
    ],
  },
  {
    id: "insight",
    label: "关注",
    items: [
      { to: "/inbox", label: "需要你", icon: <Bell size={ico} />, keywords: "inbox approval 审批 待处理 收件箱" },
      { to: "/costs", label: "成本", icon: <Wallet size={ico} />, keywords: "costs 花费 用量 费用 账单" },
      { to: "/memory", label: "记忆", icon: <Brain size={ico} />, keywords: "memory 记忆 偏好" },
    ],
  },
  {
    id: "more",
    label: "更多",
    items: [
      { to: "/skills", label: "技能", icon: <Zap size={ico} />, keywords: "skills 技能 能力" },
      { to: "/settings", label: "设置", icon: <Settings size={ico} />, keywords: "settings 设置 配置 偏好" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export interface Crumb {
  label: string;
  /** 可点击跳转；最后一级没有。 */
  to?: string;
}

const LABEL: Record<string, string> = Object.fromEntries(ALL_NAV_ITEMS.map((i) => [i.to, i.label]));

/** 路径 -> 面包屑。工作台显示“主线 › 任务名”，分支页再多一级。 */
export function crumbsFor(pathname: string, tasks: Record<string, Pick<Task, "title">>): Crumb[] {
  const path = pathname.replace(/\/+$/, "") || "/";
  const task = /^\/task\/([^/]+)(\/branches)?$/.exec(path);
  if (task) {
    const id = decodeURIComponent(task[1]!);
    const title = tasks[id]?.title ?? "任务";
    return task[2]
      ? [{ label: "主线", to: "/" }, { label: title, to: `/task/${task[1]}` }, { label: "分支" }]
      : [{ label: "主线", to: "/" }, { label: title }];
  }
  if (path === "/onboarding") return [{ label: "欢迎" }];
  return [{ label: LABEL[path] ?? "主线" }];
}
