import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@muster/ui";
import { AgentRows, useDetectedAgents } from "../skills/AgentRows";
import { Heading } from "./Steps";

/** 检测本机编程 Agent；找到的数量通过 onResult 上报给引导页（用于完成页摘要）。 */
export function DetectStep({ onResult }: { onResult?: (found: number) => void }) {
  const { state, detect } = useDetectedAgents();

  useEffect(() => {
    if (state.phase === "ready") onResult?.(state.agents.filter((a) => a.found).length);
  }, [state, onResult]);

  return (
    <div className="mx-auto w-full max-w-xl">
      <Heading title="检测本机的编程 Agent" hint="Muster 可以调用你电脑上已有的 Codex、Claude Code 等。没有也没关系，内置的原生成员随时能用。" />
      <AgentRows state={state} detect={detect} />
      {state.phase === "loading" && <p className="mt-3 text-center text-sm text-fg-2">正在检测本机的编程 Agent…</p>}
      {state.phase === "ready" && (
        <div className="mt-3 text-center">
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={detect}>重新检测</Button>
        </div>
      )}
    </div>
  );
}
