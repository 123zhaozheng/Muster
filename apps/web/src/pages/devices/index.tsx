import { useMemo } from "react";
import { Cpu, Plus, Wifi, WifiOff } from "lucide-react";
import { Button, Empty, Section, StatCard } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { Page, PageBody, PageGrid, PageHeader } from "../../components/layout";
import { DeviceCard } from "../../components/devices/DeviceCard";
import { PairCard } from "../../components/devices/PairCard";
import { RemoteBrowserPanel } from "../../components/devices/RemoteBrowserPanel";
import { HeaderTile } from "../../components/events/HeaderTile";
import { useNow } from "../../components/events/time";

export default function DevicesPage() {
  const deviceMap = useHub((s) => s.model.devices);
  const triggerMap = useHub((s) => s.model.triggers);
  const devices = useMemo(() => Object.values(deviceMap).sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || Number(b.online) - Number(a.online)), [deviceMap]);
  const ruleCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of Object.values(triggerMap)) if (t.source === "device" && t.enabled && t.params.deviceId) m[t.params.deviceId] = (m[t.params.deviceId] ?? 0) + 1;
    return m;
  }, [triggerMap]);
  const now = useNow();
  const online = devices.filter((d) => d.online).length;

  const focusPairing = () => {
    const el = document.getElementById("pair-card");
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
  };

  return (
    <Page>
      <PageHeader
        title="设备"
        subtitle="管理你的设备，随时随地让 AI 代理为你工作"
        leading={<HeaderTile shape="egg" color="sky" status="idle" />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={focusPairing}>
            配对新设备
          </Button>
        }
      />

      <div className="muster-stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-5">
        <StatCard label="设备总数" value={devices.length} suffix=" 台" icon={<Cpu />} tone="sky" hint="含本机" />
        <StatCard label="在线设备" value={online} suffix=" 台" icon={<Wifi />} tone="mint" hint="可以接收任务" />
        <StatCard label="离线设备" value={devices.length - online} suffix=" 台" icon={<WifiOff />} tone="neutral" hint="上线后自动恢复" />
      </div>

      <PageBody
        railWidth={380}
        main={
          <>
            <Section title="我的设备" description="本机与已配对的电脑、服务器">
              {devices.length === 0 ? (
                <Empty title="还没有设备" description="在右侧生成配对码，把第二台电脑接进来。" pebble={{ shape: "egg", color: "sky", status: "sleeping" }} />
              ) : (
                <PageGrid min={300}>
                  {devices.map((d) => (
                    <DeviceCard key={d.id} device={d} now={now} ruleCount={ruleCount[d.id] ?? 0} />
                  ))}
                </PageGrid>
              )}
            </Section>
            <RemoteBrowserPanel />
          </>
        }
        rail={<PairCard />}
      />
    </Page>
  );
}
