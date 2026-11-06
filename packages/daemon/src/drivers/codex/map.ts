// Pure mapping helpers: Codex app-server items/requests -> normalised DriverEvent pieces.
import type { DiffFile, Risk } from "@muster/protocol";
import type { DriverEvent } from "../../core/contracts";

const MAX_OUTPUT = 2000;
const MAX_PATCH = 20_000;

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Commands run through a login shell look like `"C:\...\pwsh.exe" -Command "..."`; show the inner part. */
function prettyCommand(cmd: string): string {
  const m = /^\s*"?[^"]*?(?:powershell|pwsh|cmd|bash|zsh|sh)(?:\.exe)?"?\s+(?:-NoProfile\s+)?(?:-Command|\/c|-lc|-c)\s+(.+)$/is.exec(cmd);
  const inner = (m?.[1] ?? cmd).trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  return truncate(inner, 200);
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/** Convert Codex `fileChange.changes` into protocol DiffFile[] (counts derived from the patch text). */
export function toDiffFiles(changes: any[]): DiffFile[] {
  return changes.map((c): DiffFile => {
    const kind: string = c?.kind?.type ?? "update";
    const path = String(c?.path ?? "");
    const text = String(c?.diff ?? "");
    let additions = 0;
    let deletions = 0;
    let patch = text;
    if (kind === "add") {
      additions = countLines(text);
      patch = `--- /dev/null\n+++ b/${path}\n` + text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => "+" + l).join("\n");
    } else if (kind === "delete") {
      deletions = countLines(text);
      patch = `--- a/${path}\n+++ /dev/null\n` + text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => "-" + l).join("\n");
    } else {
      for (const l of text.split(/\r?\n/)) {
        if (l.startsWith("+") && !l.startsWith("+++")) additions++;
        else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
      }
    }
    return { path, additions, deletions, patch: truncate(patch, MAX_PATCH) };
  });
}

/** A completed ThreadItem -> tool / diff events (agentMessage is handled by the session itself). */
export function itemToEvents(item: any): DriverEvent[] {
  switch (item?.type) {
    case "commandExecution": {
      const actions: any[] = Array.isArray(item.commandActions) ? item.commandActions : [];
      const allRead = actions.length > 0 && actions.every((a) => a?.type === "read");
      const ok = item.status === "completed" && (item.exitCode === 0 || item.exitCode == null);
      const output = typeof item.aggregatedOutput === "string" && item.aggregatedOutput ? truncate(item.aggregatedOutput, MAX_OUTPUT) : undefined;
      if (allRead) {
        const label = actions.map((a) => String(a.path ?? a.name ?? "")).filter(Boolean).join(", ") || prettyCommand(String(item.command ?? ""));
        return [{ t: "tool", tool: "read", kind: "read", label, ok, ...(output ? { output } : {}) }];
      }
      return [{ t: "tool", tool: "bash", kind: "command", label: prettyCommand(String(item.command ?? "")), ok, ...(output ? { output } : {}) }];
    }
    case "fileChange": {
      const changes: any[] = Array.isArray(item.changes) ? item.changes : [];
      const ok = item.status === "completed";
      const events: DriverEvent[] = [
        { t: "tool", tool: "edit", kind: "edit", label: changes.map((c) => String(c.path)).join(", ") || "文件改动", ok },
      ];
      if (ok && changes.length) events.push({ t: "diff", files: toDiffFiles(changes) });
      return events;
    }
    case "mcpToolCall":
      return [{ t: "tool", tool: String(item.tool ?? "mcp"), kind: "other", label: `${item.server ?? "mcp"}.${item.tool ?? ""}`, ok: item.status === "completed" }];
    case "dynamicToolCall":
      return [{ t: "tool", tool: String(item.tool ?? "tool"), kind: "other", label: String(item.tool ?? "tool"), ok: item.success ?? item.status === "completed" }];
    case "webSearch":
      return [{ t: "tool", tool: "web_search", kind: "other", label: String(item.query ?? "网页搜索"), ok: true }];
    default:
      return [];
  }
}

const DANGEROUS = /\b(rm\s+-[a-z]*r|rmdir|del\s|remove-item|format\s|git\s+push|git\s+reset\s+--hard|git\s+clean|curl\b|wget\b|invoke-webrequest|npm\s+publish|sudo\b|chmod\b|shutdown)/i;

export function commandRisk(command: string | null | undefined, actions: any[] | null | undefined, hasNetwork: boolean): Risk {
  if (command && DANGEROUS.test(command)) return "high";
  const acts = actions ?? [];
  if (acts.length > 0 && acts.every((a) => a?.type === "read" || a?.type === "listFiles" || a?.type === "search")) return "low";
  return hasNetwork ? "high" : "medium";
}
