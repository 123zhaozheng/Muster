import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { ListDetail } from "../../components/layout";
import { DeviceDetail } from "../../components/devices/DeviceDetail";
import { DeviceRow } from "../../components/devices/DeviceRow";
import { PairCard } from "../../components/devices/PairCard";
import { useNow } from "../../shell/useNow";

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

  const [selectedId, setSelectedId] = useState<string>();
  const [showDetail, setShowDetail] = useState(false);
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];

  const focusPairing = () => {
    setShowDetail(false);
    requestAnimationFrame(() => {
      const el = document.getElementById("pair-card");
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      el?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-14 shrink-0 items-center border-b border-border px-5 py-3 md:px-8 [&>*]:w-full">
        <PageHeader
          title="设备"
          subtitle="本机与已配对的电脑、服务器"
          actions={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={focusPairing}>
              配对新设备
            </Button>
          }
        />
      </div>
      <div className="min-h-0 flex-1">
        <ListDetail
          listWidth={360}
          showDetail={showDetail}
          onBack={() => setShowDetail(false)}
          backLabel="返回设备列表"
          list={
            <div className="space-y-5 p-3">
              {devices.length === 0 ? (
                <p className="px-3 py-4 text-sm text-fg-2">还没有设备。生成配对码，把第二台电脑接进来。</p>
              ) : (
                <ul className="space-y-1" aria-label="设备列表">
                  {devices.map((d) => (
                    <li key={d.id}>
                      <DeviceRow
                        device={d}
                        selected={d.id === selected?.id}
                        onSelect={() => {
                          setSelectedId(d.id);
                          setShowDetail(true);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <PairCard />
            </div>
          }
          detail={selected ? <DeviceDetail device={selected} now={now} ruleCount={ruleCount[selected.id] ?? 0} /> : <EmptyState title="还没有设备" description="在左侧生成配对码，把第二台电脑接进来。" />}
        />
      </div>
    </div>
  );
}
