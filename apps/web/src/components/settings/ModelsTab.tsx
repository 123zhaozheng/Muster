import { Button, Section, Skeleton } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { ConnectionSection } from "./ConnectionSection";
import { DefaultModelCard } from "./DefaultModelCard";
import { ModelTable } from "./ModelTable";
import { ProviderList } from "./ProviderList";
import { useModelData } from "./useModelData";

/** 设置 · 模型与连接：连接、默认模型、模型服务、可用模型。 */
export function ModelsTab() {
  const { data, refresh, retry, setSettings } = useModelData();
  const status = useHub((s) => s.status);
  const mock = useHub((s) => s.mock);

  return (
    <div className="grid gap-8">
      <ConnectionSection />
      {data.phase === "error" && (
        <Section title="模型" card>
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm font-medium text-fg">暂时读不到模型配置</p>
            <p className="text-sm text-fg-2">
              {mock ? "演示模式没有真实的模型服务；连接守护进程后才能配置模型。" : "请确认守护进程正在运行并已连接。"}
              <span className="mt-1 block font-mono text-xs text-fg-3">{data.error}</span>
            </p>
            <Button variant="secondary" onClick={retry}>重试</Button>
          </div>
        </Section>
      )}
      {data.phase === "loading" && (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
          <p className="text-center text-xs text-fg-3">{status === "open" ? "正在读取模型配置…" : "等待连接守护进程…"}</p>
        </div>
      )}
      {data.phase === "ready" && (
        <>
          <DefaultModelCard models={data.models} providers={data.providers} settings={data.settings} onSettings={setSettings} />
          <ProviderList providers={data.providers} catalog={data.catalog} models={data.models} onChanged={refresh} />
          <ModelTable models={data.models} providers={data.providers} />
        </>
      )}
    </div>
  );
}
