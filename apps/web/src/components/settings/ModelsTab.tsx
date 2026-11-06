import { Boxes, KeyRound, Layers } from "lucide-react";
import { Button, Card, Skeleton, StatCard } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { DefaultModelCard } from "./DefaultModelCard";
import { ModelTable } from "./ModelTable";
import { ProviderList } from "./ProviderList";
import { useModelData } from "./useModelData";

/** 设置 · 模型：默认模型、模型服务、可用模型。 */
export function ModelsTab() {
  const { data, refresh, retry, setSettings } = useModelData();
  const status = useHub((s) => s.status);
  const mock = useHub((s) => s.mock);

  if (data.phase === "error") {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h2 className="text-[17px] font-semibold text-ink">暂时读不到模型配置</h2>
        <p className="text-sm text-ink-soft">
          {mock ? "演示模式没有真实的模型服务；连接 daemon 后才能配置模型。" : "请确认 daemon 正在运行并已连接。"}
          <span className="mt-1 block font-mono text-xs text-ink-faint">{data.error}</span>
        </p>
        <Button variant="outline" onClick={retry}>重试</Button>
      </Card>
    );
  }

  if (data.phase === "loading") {
    return (
      <div className="grid gap-5" aria-busy="true">
        <Skeleton className="h-48 rounded-card-lg" />
        <Skeleton className="h-32 rounded-card-lg" />
        <p className="text-center text-xs text-ink-faint">{status === "open" ? "正在读取模型配置…" : "等待连接 daemon…"}</p>
      </div>
    );
  }

  const enabled = data.providers.filter((p) => p.enabled);
  const withKey = data.providers.filter((p) => p.hasApiKey).length;

  return (
    <div className="grid gap-8">
      <div className="muster-stagger grid gap-5 sm:grid-cols-3">
        <StatCard label="已启用的服务" value={enabled.length} suffix={` / ${data.providers.length}`} icon={<Layers className="size-4" />} tone="coral" />
        <StatCard label="可用模型" value={data.models.length} icon={<Boxes className="size-4" />} tone="lavender" />
        <StatCard label="已设置 Key 的服务" value={withKey} icon={<KeyRound className="size-4" />} tone="mint" />
      </div>
      <DefaultModelCard models={data.models} providers={data.providers} settings={data.settings} onSettings={setSettings} />
      <ProviderList providers={data.providers} catalog={data.catalog} models={data.models} onChanged={refresh} />
      <ModelTable models={data.models} providers={data.providers} />
    </div>
  );
}
