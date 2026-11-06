import { ShieldCheck } from "lucide-react";
import { Section, SettingsRow } from "@muster/ui";

export function SafetySection() {
  return (
    <div className="grid gap-8">
      <Section title="确认规则" description="成员要做有风险的事之前，会先在「需要你」里问你。" card>
        <SettingsRow label="需要确认的操作" description="每次请求都会写明是谁要做什么、命令原文和风险等级，由你决定。" />
        <SettingsRow label="可选的回答" description="“仅允许这一次”或“拒绝”。目前不支持“总是允许”，下一次同样的操作仍会再问你。" />
        <SettingsRow label="无人值守时" description="定时、GitHub、设备上线等触发产生的确认会自动拒绝，不会等你，也不会悄悄放行。可在事件页的触发规则里按规则调整。" />
      </Section>
      <div className="flex items-start gap-3 rounded-card border border-border bg-surface px-5 py-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-fg-2">API Key 只保存在本机的守护进程里，页面和日志不会显示它。</p>
      </div>
    </div>
  );
}
