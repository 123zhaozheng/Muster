// Global search data layer: pure functions over the hub model (testable without React).
import type { Bot, Entry, Task, Thread } from "@muster/protocol";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "@muster/protocol";
import { taskStatusMeta } from "../lib/status";
import { ALL_NAV_ITEMS, type NavItem } from "./navigation";

type SearchGroup = "页面" | "成员" | "工单" | "对话";
const GROUP_ORDER: SearchGroup[] = ["页面", "成员", "工单", "对话"];

export interface SearchResult {
  id: string;
  group: SearchGroup;
  label: string;
  hint?: string;
  /** Route to open (may carry a query string). */
  to: string;
  nav?: NavItem;
  bot?: Bot;
}

interface SearchSource {
  bots: Record<string, Bot>;
  tasks: Record<string, Task>;
  threads: Record<string, Thread>;
  /** Entries of the threads loaded so far. Unloaded threads are not searched. */
  entries: Record<string, Entry[]>;
}

const LIMIT_EMPTY: Record<SearchGroup, number> = { 页面: 10, 成员: 6, 工单: 5, 对话: 0 };
const LIMIT_QUERY: Record<SearchGroup, number> = { 页面: 5, 成员: 5, 工单: 6, 对话: 8 };
const SNIPPET = 48;

const tokensOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, tokens: string[]): boolean => {
  const t = text.toLowerCase();
  return tokens.every((k) => t.includes(k));
};

function snippet(text: string, tokens: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(tokens[0] ?? ""));
  const start = Math.max(0, at - 12);
  const cut = flat.slice(start, start + SNIPPET);
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET < flat.length ? "…" : ""}`;
}

const entryText = (e: Entry): string | undefined => (e.kind === "user" || e.kind === "bot" || e.kind === "steer" ? e.text : undefined);

const routeOfThread = (t: Thread | undefined, threadId: string): string => (threadId === MAIN_THREAD_ID || !t?.taskId ? "/" : `/task/${t.taskId}`);

export function searchAll(src: SearchSource, query: string): SearchResult[] {
  const tokens = tokensOf(query);
  const empty = tokens.length === 0;
  const limit = empty ? LIMIT_EMPTY : LIMIT_QUERY;
  const out: Record<SearchGroup, SearchResult[]> = { 页面: [], 成员: [], 工单: [], 对话: [] };

  for (const n of ALL_NAV_ITEMS) {
    if (empty || matches(`${n.label} ${n.keywords}`, tokens)) out.页面.push({ id: `page:${n.to}`, group: "页面", label: n.label, to: n.to, nav: n });
  }

  const latestTaskOf = new Map<string, Task>();
  for (const t of Object.values(src.tasks)) {
    const cur = latestTaskOf.get(t.botId);
    if (!cur || t.startedAt > cur.startedAt) latestTaskOf.set(t.botId, t);
  }
  const bots = Object.values(src.bots).sort((a, b) => (a.id === MAIN_BOT_ID ? -1 : b.id === MAIN_BOT_ID ? 1 : a.name.localeCompare(b.name)));
  for (const b of bots) {
    if (!empty && !matches(`${b.name} ${b.engineLabel} ${b.kind} ${b.tagline ?? ""} ${b.skills.join(" ")}`, tokens)) continue;
    const latest = latestTaskOf.get(b.id);
    out.成员.push({ id: `bot:${b.id}`, group: "成员", label: b.name, hint: b.engineLabel, to: b.id === MAIN_BOT_ID ? "/" : latest ? `/task/${latest.id}` : "/crew", bot: b });
  }

  const byStart = Object.values(src.tasks).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  for (const t of byStart) {
    const botName = src.bots[t.botId]?.name ?? "";
    if (!empty && !matches(`${t.title} ${botName} ${t.branch ?? ""} ${src.threads[t.threadId]?.title ?? ""}`, tokens)) continue;
    out.工单.push({ id: `task:${t.id}`, group: "工单", label: t.title, hint: `${botName} · ${taskStatusMeta(t.status).label}`, to: `/task/${t.id}`, bot: src.bots[t.botId] });
  }

  if (!empty) {
    const hits: Array<{ ts: string; r: SearchResult }> = [];
    for (const [threadId, list] of Object.entries(src.entries)) {
      const thread = src.threads[threadId];
      for (const e of list) {
        const text = entryText(e);
        if (!text || !matches(text, tokens)) continue;
        hits.push({ ts: e.ts, r: { id: `entry:${e.id}`, group: "对话", label: snippet(text, tokens), hint: thread?.title ?? "对话", to: `${routeOfThread(thread, threadId)}?msg=${encodeURIComponent(e.id)}` } });
      }
    }
    out.对话 = hits.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).map((h) => h.r);
  }

  return GROUP_ORDER.flatMap((g) => out[g].slice(0, limit[g]));
}
