// Fake `codex app-server` for driver unit tests. Speaks line-delimited JSON-RPC (no "jsonrpc" field) on stdio.
// Behaviour is selected by keywords in the user prompt; every received message is appended to $FAKE_LOG (if set).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const LOG = process.env.FAKE_LOG;
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const log = (m) => { if (LOG) appendFileSync(LOG, JSON.stringify(m) + "\n"); };

let threadSeq = 0;
let turnSeq = 0;
let itemSeq = 0;
let srvSeq = 0;
let tokens = 0;
const threads = new Map(); // id -> { turns: [{ id }] }
let active = null; // { threadId, turnId, slow }
const waiters = new Map(); // server-request id -> resolve

const thread = (id, turns) => ({ id, turns: turns.map((t) => ({ id: t.id, status: "completed", items: [] })) });
const note = (method, params) => out({ method, params });

function askServer(method, params) {
  const id = `srv-${++srvSeq}`;
  out({ id, method, params });
  return new Promise((resolve) => waiters.set(id, resolve));
}

function completeTurn(status, error) {
  if (!active) return;
  const { threadId, turnId } = active;
  active = null;
  note("turn/completed", { threadId, turn: { id: turnId, status, items: [], error: error ? { message: error } : null } });
}

async function runTurn(threadId, turnId, text) {
  const itemBase = `item_${++itemSeq}`;
  const t = { threadId, turnId };
  if (text.includes("slow")) {
    active.slow = true;
    note("item/agentMessage/delta", { ...t, itemId: itemBase, delta: "开始处理…" });
    return; // finishes on steer / interrupt
  }
  if (text.includes("crash")) process.exit(3);
  if (text.includes("fail")) {
    note("error", { error: { message: "模型不可用" }, willRetry: false, ...t });
    return completeTurn("failed", "模型不可用");
  }
  if (text.includes("approve")) {
    const cmdItem = { type: "commandExecution", id: `${itemBase}_c`, command: "rm -rf build", cwd: "/w", status: "inProgress", commandActions: [{ type: "unknown", command: "rm -rf build" }], aggregatedOutput: null, exitCode: null };
    note("item/started", { ...t, item: cmdItem });
    const res = await askServer("item/commandExecution/requestApproval", {
      kind: "command", ...t, itemId: cmdItem.id, command: "rm -rf build", cwd: "/w", reason: "清理构建产物", commandActions: cmdItem.commandActions,
    });
    const ok = res.decision === "accept";
    note("item/completed", { ...t, item: { ...cmdItem, status: ok ? "completed" : "declined", exitCode: ok ? 0 : null, aggregatedOutput: ok ? "removed" : null } });
    note("item/completed", { ...t, item: { type: "agentMessage", id: `${itemBase}_m`, text: `decision:${res.decision}` } });
    return completeTurn("completed");
  }
  if (text.includes("edit")) {
    const changes = [{ path: "src/a.ts", kind: { type: "update", move_path: null }, diff: "@@ -1,2 +1,2 @@\n-old\n+new\n keep\n+extra\n" }, { path: "src/b.ts", kind: { type: "add" }, diff: "l1\nl2\n" }];
    const item = { type: "fileChange", id: `${itemBase}_f`, changes, status: "inProgress" };
    note("item/started", { ...t, item });
    const res = await askServer("item/fileChange/requestApproval", { ...t, itemId: item.id, reason: "写入文件" });
    const ok = res.decision === "accept";
    note("item/completed", { ...t, item: { ...item, status: ok ? "completed" : "declined" } });
    return completeTurn("completed");
  }
  if (text.includes("tools")) {
    note("item/completed", { ...t, item: { type: "commandExecution", id: `${itemBase}_1`, command: "cat README.md", cwd: "/w", status: "completed", exitCode: 0, aggregatedOutput: "# hi", commandActions: [{ type: "read", command: "cat README.md", name: "README.md", path: "/w/README.md" }] } });
    note("item/completed", { ...t, item: { type: "commandExecution", id: `${itemBase}_2`, command: "pnpm test", cwd: "/w", status: "failed", exitCode: 1, aggregatedOutput: "boom", commandActions: [{ type: "unknown", command: "pnpm test" }] } });
    note("item/completed", { ...t, item: { type: "fileChange", id: `${itemBase}_3`, status: "completed", changes: [{ path: "x.ts", kind: { type: "update", move_path: null }, diff: "@@\n-a\n+b\n" }] } });
    return completeTurn("completed");
  }
  if (text.includes("reason")) {
    const r1 = { type: "reasoning", id: `${itemBase}_r1`, summary: [], content: [] };
    note("item/started", { ...t, item: r1 });
    note("item/reasoning/summaryTextDelta", { ...t, itemId: r1.id, delta: "先读", summaryIndex: 0 });
    note("item/reasoning/summaryTextDelta", { ...t, itemId: r1.id, delta: "代码", summaryIndex: 0 });
    note("item/reasoning/textDelta", { ...t, itemId: r1.id, delta: "原文不重复", contentIndex: 0 });
    note("item/reasoning/summaryPartAdded", { ...t, itemId: r1.id, summaryIndex: 1 });
    note("item/reasoning/summaryTextDelta", { ...t, itemId: r1.id, delta: "再改", summaryIndex: 1 });
    note("item/completed", { ...t, item: { ...r1, summary: ["先读代码", "再改"] } });
    note("item/completed", { ...t, item: { type: "reasoning", id: `${itemBase}_r2`, summary: ["整段推理"], content: [] } });
    note("item/completed", { ...t, item: { type: "reasoning", id: `${itemBase}_r3`, summary: [], content: [] } });
    note("item/completed", { ...t, item: { type: "agentMessage", id: `${itemBase}_m`, text: "好了" } });
    return completeTurn("completed");
  }
  if (text.includes("nodelta")) {
    note("item/completed", { ...t, item: { type: "agentMessage", id: `${itemBase}_m`, text: "整段回复" } });
    return completeTurn("completed");
  }
  // default: stream two deltas, then token usage
  note("item/agentMessage/delta", { ...t, itemId: itemBase, delta: "你好，" });
  note("item/agentMessage/delta", { ...t, itemId: itemBase, delta: "世界" });
  note("item/completed", { ...t, item: { type: "agentMessage", id: itemBase, text: "你好，世界" } });
  tokens += 100;
  note("thread/tokenUsage/updated", { ...t, tokenUsage: { total: { totalTokens: tokens }, last: { totalTokens: 100 }, modelContextWindow: null } });
  completeTurn("completed");
}

async function handle(msg) {
  log(msg);
  if (msg.method === undefined) {
    // response to one of our server requests
    const w = waiters.get(msg.id);
    if (w) { waiters.delete(msg.id); w(msg.result ?? { error: msg.error }); }
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return out({ id, result: { userAgent: "fake/0", codexHome: "/home/.codex", platformFamily: "unix", platformOs: "linux" } });
    case "initialized":
      return;
    case "thread/start": {
      const tid = `thr_${++threadSeq}`;
      threads.set(tid, { turns: [] });
      out({ id, result: { thread: thread(tid, []), model: "fake" } });
      return note("thread/started", { thread: thread(tid, []) });
    }
    case "thread/resume": {
      const known = threads.get(params.threadId) ?? { turns: [{ id: "old_1" }, { id: "old_2" }] };
      threads.set(params.threadId, known);
      return out({ id, result: { thread: thread(params.threadId, known.turns), model: "fake" } });
    }
    case "thread/fork": {
      const parent = threads.get(params.threadId) ?? { turns: [] };
      const idx = parent.turns.findIndex((x) => x.id === params.lastTurnId);
      const kept = idx >= 0 ? parent.turns.slice(0, idx + 1) : parent.turns;
      const tid = `thr_fork_${++threadSeq}`;
      threads.set(tid, { turns: kept.map((x) => ({ id: `${tid}_${x.id}` })) });
      return out({ id, result: { thread: thread(tid, threads.get(tid).turns), model: "fake" } });
    }
    case "turn/start": {
      const th = threads.get(params.threadId);
      const turnId = `turn_${++turnSeq}`;
      th.turns.push({ id: turnId });
      active = { threadId: params.threadId, turnId };
      out({ id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      note("turn/started", { threadId: params.threadId, turn: { id: turnId, status: "inProgress", items: [] } });
      const text = params.input.map((i) => i.text ?? "").join("");
      return runTurn(params.threadId, turnId, text);
    }
    case "turn/steer": {
      const text = params.input.map((i) => i.text ?? "").join("");
      if (!active || active.turnId !== params.expectedTurnId || text.includes("reject")) {
        return out({ id, error: { code: -32600, message: "expectedTurnId mismatch" } });
      }
      out({ id, result: { turnId: active.turnId } });
      note("item/agentMessage/delta", { threadId: active.threadId, turnId: active.turnId, itemId: "steer_msg", delta: `收到插话：${text}` });
      return completeTurn("completed");
    }
    case "turn/interrupt": {
      out({ id, result: {} });
      return completeTurn("interrupted");
    }
    default:
      return out({ id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  void handle(JSON.parse(line));
});
