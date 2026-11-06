// Single source of navigation: sidebar groups and the "pages" results of global search.
import type { ReactNode } from "react";
import { Bell, Brain, CalendarDays, FolderOpen, House, Monitor, Settings, Users, Wallet, Zap } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** NavLink `end` matching (home "/" must be exact). */
  end?: boolean;
  /** Extra lowercase search terms for global search. */
  keywords: string;
}

const ico = 20;

export const NAV_GROUPS: Array<{ id: string; label?: string; items: NavItem[] }> = [
  {
    id: "main",
    items: [
      { to: "/", label: "主线", icon: <House size={ico} />, end: true, keywords: "home pip chat 首页 对话 主页" },
      { to: "/crew", label: "团队", icon: <Users size={ico} />, keywords: "crew team bot 成员 子agent" },
      { to: "/events", label: "事件", icon: <CalendarDays size={ico} />, keywords: "events trigger 触发器 定时 日程 动态" },
      { to: "/library", label: "资源库", icon: <FolderOpen size={ico} />, keywords: "library files 文件 文档 图片 产出" },
      { to: "/devices", label: "设备", icon: <Monitor size={ico} />, keywords: "devices 电脑 配对" },
    ],
  },
  {
    id: "personal",
    label: "个人",
    items: [
      { to: "/inbox", label: "需要你", icon: <Bell size={ico} />, keywords: "inbox approval 审批 待处理 收件箱 确认" },
      { to: "/memory", label: "记忆", icon: <Brain size={ico} />, keywords: "memory 记忆 偏好" },
      { to: "/skills", label: "技能", icon: <Zap size={ico} />, keywords: "skills 技能 能力" },
      { to: "/costs", label: "成本", icon: <Wallet size={ico} />, keywords: "costs 花费 用量 费用 账单" },
    ],
  },
];

/** Pinned at the bottom of the sidebar. */
export const SETTINGS_ITEM: NavItem = { to: "/settings", label: "设置", icon: <Settings size={ico} />, keywords: "settings 设置 配置 偏好 外观 模型" };

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
