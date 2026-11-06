import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import type { DetectedAgent } from "@muster/protocol";
import { Badge, Button, Card, Skeleton } from "@muster/ui";
import { hubRequest, useHub } from "../../lib/hub";
import { Heading } from "./Steps";

type State = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; agents: DetectedAgent[] };

const ENGINE_NAME: Record<DetectedAgent["engine"], string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", other: "其他 Agent" };
const ENGINE_TONE: Record<DetectedAgent["engine"], string> = {
  codex: "bg-mint-soft text-mint-deep",
  claude: "bg-coral-soft text-coral-deep",
  opencode: "bg-sky-soft text-sky-deep",
  other: "bg-lavender-soft text-lavender-deep",
};
const LOGIN_HINT: Partial<Record<DetectedAgent["engine"], string>> = {
  codex: "登录方式：在终端运行 codex login",
  claude: "登录方式：在终端运行 claude 并按提示登录",
};

/** 检测本机编程 Agent；结果通过 onResult 上报给引导页（用于完成页摘要）。 */
export function DetectStep({ onResult }: { onResult?: (found: number) => void }) {
  const connected = useHub((s) => s.status === "open" && s.client !== null);
  const [state, setState] = useState<State>({ phase: "loading" });

  const detect = useCallback(() => {
    let alive = true;
    setState({ phase: "loading" });
    hubRequest("bot.detectAgents", {})
      .then((r) => {
        if (!alive) return;
        const agents = r.agents ?? [];
        setState({ phase: "ready", agents });
        onResult?.(agents.filter((a) => a.found).length);
      })
      .catch((e: unknown) => alive && setState({ phase: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [onResult]);

  useEffect(() => (connected ? detect() : undefined), [connected, detect]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Heading title="检测本机的编程 Agent" hint="Muster 可以调用你电脑上已有的 Codex、Claude Code 等。没有也没关系，内置的原生成员随时能用。" />
      {state.phase === "loading" && (
        <div className="grid gap-3" aria-busy="true" aria-label="正在检测本机的编程 Agent">
          {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-card" />)}
          <p className="text-center text-sm text-ink-soft">正在检测本机的编程 Agent…</p>
        </div>
      )}
      {state.phase === "error" && (
        <Card className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-ink-soft">
          <span>暂时无法检测本机 Agent（{state.message}）。</span>
          <Button size="sm" variant="outline" onClick={detect}>重试</Button>
        </Card>
      )}
      {state.phase === "ready" && (
        <>
          {state.agents.length === 0 ? (
            <Card className="px-5 py-6 text-center text-sm text-ink-soft">没有可检测的 Agent，可以先跳过这一步。</Card>
          ) : (
            <ul className="muster-stagger grid gap-3">
              {state.agents.map((a) => (
                <li key={`${a.engine}-${a.command}`} data-found={a.found}>
                  <Card frosted className="flex items-center gap-4 px-5 py-4 transition-[transform,box-shadow] duration-200 ease-muster hover:-translate-y-0.5 hover:shadow-lift">
                    <span className={`grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold ${ENGINE_TONE[a.engine]}`} aria-hidden>
                      {ENGINE_NAME[a.engine].charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-ink">{ENGINE_NAME[a.engine]}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-ink-soft">
                        <Terminal className="size-3.5 shrink-0" />
                        {a.command}
                        {a.version ? ` · ${a.version}` : ""}
                      </div>
                      {LOGIN_HINT[a.engine] && a.found && <div className="mt-1 text-xs text-ink-faint">{LOGIN_HINT[a.engine]}</div>}
                    </div>
                    <Badge tone={a.found ? "mint" : "neutral"} dot={a.found}>{a.found ? "已检测到" : "未检测到"}</Badge>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 text-center">
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={detect}>重新检测</Button>
          </div>
        </>
      )}
    </div>
  );
}
