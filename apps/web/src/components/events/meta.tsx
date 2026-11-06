import type { ReactNode } from "react";
import { Eye, Hand, Zap } from "lucide-react";
import type { HubEvent, TriggerMode } from "@muster/protocol";
import type { Tone } from "@muster/ui";

export const MODE_LABEL: Record<TriggerMode, string> = { observe: "观察", ask: "询问", auto: "自动" };

/** Mode picker in the schedule editor: one sentence about what the mode does. */
export const MODE_META: Record<TriggerMode, { detail: string; icon: ReactNode }> = {
  observe: { detail: "只记录“将会做什么”，不会真正执行。适合先观察规则是否合理。", icon: <Eye /> },
  ask: { detail: "先在“需要你”里问你，你点头后才执行。", icon: <Hand /> },
  auto: { detail: "直接交给成员执行，仍受每日预算限制。", icon: <Zap /> },
};

/** Outcome of one event (HubEvent.status); not the same thing as a task's status. */
export const EVENT_STATUS: Record<NonNullable<HubEvent["status"]>, { label: string; tone: Tone }> = {
  recorded: { label: "已记录", tone: "neutral" },
  delivered: { label: "已送达", tone: "success" },
  dispatched: { label: "已派发", tone: "accent" },
  ignored: { label: "已忽略", tone: "neutral" },
  failed: { label: "失败", tone: "danger" },
};

export const GITHUB_EVENTS: { value: string; label: string; description: string }[] = [
  { value: "pull_request.opened", label: "PR 打开", description: "有人新开了 Pull Request" },
  { value: "pull_request.merged", label: "PR 合并", description: "Pull Request 被合并" },
  { value: "issues.opened", label: "Issue 打开", description: "有人新开了 Issue" },
  { value: "push", label: "推送代码", description: "有新的提交被推送" },
];
