import type { TriggerRule } from "@muster/protocol";
import { toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Dry-run a rule once; the resulting event shows up in the timeline. */
export async function fireTrigger(rule: Pick<TriggerRule, "id" | "label">): Promise<boolean> {
  try {
    await hubRequest("trigger.fire", { triggerId: rule.id });
    toast.success("已试跑一次", { description: `「${rule.label}」的结果见事件流` });
    return true;
  } catch (e) {
    toast.error("试跑失败", { description: msg(e) });
    return false;
  }
}

export async function setTriggerEnabled(rule: TriggerRule, enabled: boolean): Promise<void> {
  try {
    await hubRequest("trigger.upsert", { trigger: { ...rule, enabled } });
    toast.success(enabled ? "日程已启用" : "日程已停用", { description: rule.label });
  } catch (e) {
    toast.error("切换失败", { description: msg(e) });
  }
}
