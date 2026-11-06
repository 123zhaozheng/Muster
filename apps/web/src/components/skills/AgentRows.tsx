import { useCallback, useEffect, useState } from "react";
import type { DetectedAgent } from "@muster/protocol";
import { Badge, Button, Card, Skeleton } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";

type DetectState = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; agents: DetectedAgent[] };

/** 调用 bot.detectAgents；连接建立后自动检测一次，可手动重新检测。 */
export function useDetectedAgents() {
  const connected = useHub((s) => s.status === "open" && s.client !== null);
  const [state, setState] = useState<DetectState>({ phase: "loading" });

  const detect = useCallback(() => {
    setState({ phase: "loading" });
    let alive = true;
    hubRequest("bot.detectAgents", {})
      .then((r) => alive && setState({ phase: "ready", agents: r.agents ?? [] }))
      .catch((e: unknown) => alive && setState({ phase: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => { alive = false; };
  }, []);

  useEffect(() => (connected ? detect() : undefined), [connected, detect]);
  return { state, detect };
}

const ENGINE_NAME: Record<DetectedAgent["engine"], string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", other: "其他 Agent" };

const LOGIN_HINT: Partial<Record<DetectedAgent["engine"], string>> = {
  codex: "登录方式：在终端运行 codex login",
  claude: "登录方式：在终端运行 claude 并按提示登录",
};

const INSTALL_HINT: Partial<Record<DetectedAgent["engine"], string>> = {
  codex: "没有找到 codex 命令。安装后点“重新检测”。",
  claude: "没有找到 claude 命令。安装后点“重新检测”。",
};

/** 外部 Agent 检测结果（技能页与首次引导共用）。不使用任何官方 Logo。 */
export function AgentRows({ state, detect }: { state: DetectState; detect: () => void }) {
  if (state.phase === "loading") {
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="正在检测本机的编程 Agent">
        {[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-card" />)}
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-fg-2">
        <span>暂时无法检测本机 Agent（{state.message}）。</span>
        <Button size="sm" variant="secondary" onClick={detect}>重试</Button>
      </Card>
    );
  }
  if (state.agents.length === 0) return <Card className="px-5 py-4 text-sm text-fg-2">没有可检测的 Agent。</Card>;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {state.agents.map((a) => (
          <li key={`${a.engine}-${a.command}`} data-found={a.found} className="flex items-center gap-3 px-5 py-3.5">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-control text-sm font-semibold ${a.found ? "bg-success-surface text-success" : "bg-surface-muted text-fg-3"}`}
              aria-hidden
            >
              {ENGINE_NAME[a.engine].charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg">{ENGINE_NAME[a.engine]}</div>
              <div className="truncate font-mono text-xs text-fg-3">{a.command}{a.version ? ` · v${a.version}` : ""}</div>
              {a.found && LOGIN_HINT[a.engine] && <div className="mt-0.5 text-xs text-fg-2">{LOGIN_HINT[a.engine]}</div>}
              {!a.found && INSTALL_HINT[a.engine] && <div className="mt-0.5 text-xs text-warning">{INSTALL_HINT[a.engine]}</div>}
            </div>
            <Badge tone={a.found ? "success" : "neutral"} dot={a.found}>{a.found ? "已检测到" : "未检测到"}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
