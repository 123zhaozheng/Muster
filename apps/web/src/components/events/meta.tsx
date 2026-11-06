import type { ReactNode } from "react";
import { Eye, Hand, Zap } from "lucide-react";
import type { TriggerMode } from "@muster/protocol";
import type { ChipTone } from "@muster/ui";

export const MODE_LABEL: Record<TriggerMode, string> = { observe: "观察", ask: "询问", auto: "自动" };

/** Mode cards in the editor + badges on rule cards. */
export const MODE_META: Record<TriggerMode, { tone: ChipTone; hint: string; detail: string; icon: ReactNode }> = {
  observe: { tone: "sky", hint: "只记录，不执行", detail: "只记录“将会做什么”，不会真正执行。适合先观察规则是否合理。", icon: <Eye /> },
  ask: { tone: "amber", hint: "先问你，再执行", detail: "先在收件箱问你，你点头后才执行。", icon: <Hand /> },
  auto: { tone: "mint", hint: "直接交给成员", detail: "直接交给成员执行，仍受每日预算限制。", icon: <Zap /> },
};

export const GITHUB_EVENTS: { value: string; label: string; description: string }[] = [
  { value: "pull_request.opened", label: "PR 打开", description: "有人新开了 Pull Request" },
  { value: "pull_request.merged", label: "PR 合并", description: "Pull Request 被合并" },
  { value: "issues.opened", label: "Issue 打开", description: "有人新开了 Issue" },
  { value: "push", label: "推送代码", description: "有新的提交被推送" },
];
