import { ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from "lucide-react";
import type { Risk } from "@muster/protocol";
import type { Tone } from "@muster/ui";

export const RISK_META: Record<Risk, { label: string; tone: Tone; icon: LucideIcon; hint: string }> = {
  low: { label: "低风险", tone: "success", icon: ShieldCheck, hint: "只读或可轻松撤销" },
  medium: { label: "中风险", tone: "warning", icon: ShieldQuestion, hint: "会改动本机文件或安装依赖" },
  high: { label: "高风险", tone: "danger", icon: ShieldAlert, hint: "可能删除数据或访问外部，且难以撤销" },
};

export const RESOLVED_TEXT = { allowed: "已允许", denied: "已拒绝", expired: "已过期" } as const;
