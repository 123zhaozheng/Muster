import { useEffect, useState } from "react";
import type { ModelInfo, ModelProviderConfig } from "@muster/protocol";
import { hubRequest, useHub } from "../../lib/hub";

export interface ModelOptionsState {
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
  providers: ModelProviderConfig[];
}

/** 拉取可选模型（model.list）与 provider 名称（model.providers）；`models.changed` 推送后会重新拉取。 */
export function useModelOptions(enabled: boolean): ModelOptionsState {
  const settings = useHub((s) => s.model.modelSettings);
  const [state, setState] = useState<ModelOptionsState>({ loading: true, error: null, models: [], providers: [] });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([hubRequest("model.list", {}), hubRequest("model.providers", {}).catch(() => null)])
      .then(([list, provs]) => alive && setState({ loading: false, error: null, models: list.models, providers: provs?.providers ?? [] }))
      .catch((e: unknown) => alive && setState({ loading: false, error: e instanceof Error ? e.message : String(e), models: [], providers: [] }));
    return () => {
      alive = false;
    };
  }, [enabled, settings]);

  return state;
}
