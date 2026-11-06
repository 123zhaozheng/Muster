import { useCallback, useEffect, useState } from "react";
import type { DetectedAgent } from "@muster/protocol";
import { Button, Card, Chip, Skeleton } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";

export type State ={ phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; agents: DetectedAgent[] };

/** 调用 bot.detectAgents；连接建立后自动检测一次，可手动重试。 */
export function useDetectedAgents() {
  const connected = useHub((s) => s.status === "open" && s.client !== null);
  const [state, setState] = useState<State>({ phase: "loading" });

  const detect = useCallback(() => {
    setState({ phase: "loading" });
    let alive = true;
    hubRequest("bot.detectAgents", {})
      .then((r) => alive && setState({ phase: "ready", agents: r.agents }))
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
  codex: "没有找到 codex 命令。安装后点右上角的“重新检测”。",
  claude: "没有找到 claude 命令。安装后点右上角的“重新检测”。",
};

/** 技能页的“外部 Agent”卡片网格。重新检测按钮由页面放在区块右上角（传入 detect）。 */
export function AgentCards({ state, detect }: { state: State; detect: () => void }) {
  if (state.phase === "loading") {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-ink-soft">
        <span>暂时无法检测本机 Agent（{state.message}）。</span>
        <Button size="sm" variant="outline" onClick={detect}>重试</Button>
      </Card>
    );
  }
  if (state.agents.length === 0) return <Card className="p-5 text-sm text-ink-soft">没有可检测的 Agent。</Card>;
  return (
    <ul className="muster-stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {state.agents.map((a) => (
        <li key={`${a.engine}-${a.command}`} data-found={a.found}>
          <Card hoverable className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-center gap-3">
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-2xl text-base font-semibold ${a.found ? "bg-mint-soft text-mint-deep" : "bg-canvas-deep text-ink-faint"}`}
                aria-hidden
              >
                {ENGINE_NAME[a.engine].charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{ENGINE_NAME[a.engine]}</div>
                <div className="truncate font-mono text-xs text-ink-faint">{a.command}{a.version ? ` · v${a.version}` : ""}</div>
              </div>
              <Chip tone={a.found ? "mint" : "neutral"}>{a.found ? "已检测到" : "未检测到"}</Chip>
            </div>
            {LOGIN_HINT[a.engine] && <div className="rounded-2xl bg-canvas-deep/70 px-3.5 py-2 text-xs text-ink-soft">{LOGIN_HINT[a.engine]}</div>}
            {!a.found && INSTALL_HINT[a.engine] && <div className="text-xs text-amber-deep">{INSTALL_HINT[a.engine]}</div>}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** 外部 Agent 检测结果列表（技能页与首次引导共用）。文案不使用任何官方 Logo。 */
export function AgentList() {
  const { state, detect } = useDetectedAgents();

  if (state.phase === "loading") return <div className="py-4 text-sm text-ink-soft">正在检测本机的编程 Agent…</div>;
  if (state.phase === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card bg-canvas-deep px-4 py-3 text-sm text-ink-soft">
        <span>暂时无法检测本机 Agent（{state.message}）。</span>
        <Button size="sm" variant="outline" onClick={detect}>重试</Button>
      </div>
    );
  }
  if (state.agents.length === 0) return <div className="py-4 text-sm text-ink-soft">没有可检测的 Agent。</div>;

  return (
    <div>
      <ul className="grid gap-3">
        {state.agents.map((a) => (
          <li key={`${a.engine}-${a.command}`} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3" data-found={a.found}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-canvas-deep text-sm font-semibold text-ink-soft" aria-hidden>
              {ENGINE_NAME[a.engine].charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{ENGINE_NAME[a.engine]}</div>
              <div className="truncate font-mono text-xs text-ink-soft">
                {a.command}
                {a.version ? ` · ${a.version}` : ""}
              </div>
              {LOGIN_HINT[a.engine] && <div className="mt-0.5 text-xs text-ink-faint">{LOGIN_HINT[a.engine]}</div>}
            </div>
            <Chip tone={a.found ? "mint" : "neutral"}>{a.found ? "已检测到" : "未检测到"}</Chip>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-right">
        <Button size="sm" variant="ghost" onClick={detect}>重新检测</Button>
      </div>
    </div>
  );
}
