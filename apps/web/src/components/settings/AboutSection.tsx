import { Pebble, Section, SettingsRow } from "@muster/ui";
import pkg from "../../../package.json";

export function AboutSection() {
  return (
    <Section title="关于 Muster" description="个人 Agent 指挥台。" card>
      <div className="flex items-center gap-4 pb-4">
        <Pebble shape="round" color="peach" status="idle" size={48} />
        <div>
          <div className="text-body font-semibold text-fg">Muster</div>
          <div className="text-sm text-fg-2">把你的 Agent 们召集在一处。</div>
        </div>
      </div>
      <SettingsRow label="版本">
        <span className="font-mono text-sm text-fg">{pkg.version}</span>
      </SettingsRow>
      <SettingsRow label="开源许可" description="具体许可证将在首个公开版本确认。" />
    </Section>
  );
}
