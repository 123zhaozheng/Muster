// 模型页的数据：model.catalog / model.providers / model.list。连接后自动拉取，models.changed 推送后自动刷新。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelInfo, ModelProviderConfig, ModelSettings, ProviderCatalogEntry } from "@muster/protocol";
import { hubRequest, useHub } from "../../lib/hub";

interface ModelData {
  phase: "loading" | "ready" | "error";
  error?: string;
  catalog: ProviderCatalogEntry[];
  providers: ModelProviderConfig[];
  settings: ModelSettings;
  models: ModelInfo[];
}

const EMPTY: ModelData = { phase: "loading", catalog: [], providers: [], settings: {}, models: [] };

export function useModelData() {
  const connected = useHub((s) => s.status === "open" && s.client !== null);
  const pushed = useHub((s) => s.model.modelSettings); // models.changed 会换掉这个对象
  const [data, setData] = useState<ModelData>(EMPTY);
  const seq = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const my = ++seq.current;
    try {
      const [cat, prov, list] = await Promise.all([
        hubRequest("model.catalog", {}),
        hubRequest("model.providers", {}),
        hubRequest("model.list", {}),
      ]);
      if (my !== seq.current) return;
      setData({ phase: "ready", catalog: cat.providers, providers: prov.providers, settings: prov.settings, models: list.models });
    } catch (e) {
      if (my !== seq.current) return;
      setData((d) => ({ ...d, phase: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, pushed, refresh]);

  const setSettings = useCallback((settings: ModelSettings) => setData((d) => ({ ...d, settings })), []);
  const retry = useCallback(() => {
    setData((d) => ({ ...d, phase: "loading" }));
    void refresh();
  }, [refresh]);

  return { data, refresh, retry, setSettings };
}
