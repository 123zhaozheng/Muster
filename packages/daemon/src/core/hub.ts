// OWNER: lead. In-memory hub over the shared reducer. B1 owns server/journal around it.
import type { Bot, PushPayload, Snapshot, Thread, WirePush } from "@muster/protocol";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "@muster/protocol";
import { applyPush, emptyModel, snapshotOf, type HubModel } from "@muster/protocol/reducer";
import type { Hub } from "./contracts";

/** Default crew on a fresh install. Journal replay (if any) replaces this via hub.load(). */
export function seedModel(now: string): HubModel {
  const bot = (b: Omit<Bot, "status" | "skills" | "costWeekUsd"> & Partial<Bot>): Bot => ({ status: "idle", skills: [], costWeekUsd: 0, builtin: true, ...b });
  const bots: Bot[] = [
    bot({ id: MAIN_BOT_ID, name: "Pip", kind: "main", engineLabel: "主 Bot · 只做分发", shape: "round", color: "cream", threadId: MAIN_THREAD_ID, skills: ["任务分发"] }),
    bot({ id: "bot-xiaoma", name: "小码", kind: "codex", engineLabel: "Codex", shape: "square", color: "mint", threadId: "", skills: ["代码生成", "调试优化"] }),
    bot({ id: "bot-ake", name: "阿克", kind: "claude", engineLabel: "Claude", shape: "blob", color: "peach", threadId: "", skills: ["深度分析", "写作总结"] }),
    bot({ id: "bot-xiaotan", name: "小探", kind: "native", engineLabel: "内置研究员", shape: "egg", color: "sky", threadId: "", skills: ["研究调研"], status: "sleeping", tools: ["files", "web"], persona: "你是小探，Muster 团队的研究员。擅长检索资料、阅读代码与文档、对比方案，结论简洁、注明来源，不确定就明说。" }),
    bot({ id: "bot-xiaowen", name: "小文", kind: "native", engineLabel: "内置办公助手", shape: "flat", color: "lilac", threadId: "", skills: ["文档处理"], status: "sleeping", tools: ["files", "edit"], persona: "你是小文，Muster 团队的办公助手。擅长整理文档、写周报纪要、处理表格与日程，输出结构清晰、可直接使用。" }),
  ];
  const main: Thread = { id: MAIN_THREAD_ID, title: "主线", botId: MAIN_BOT_ID, createdAt: now, updatedAt: now };
  const m = emptyModel();
  return {
    ...m,
    serverTime: now,
    bots: Object.fromEntries(bots.map((b) => [b.id, b])),
    threads: { [MAIN_THREAD_ID]: main },
    entries: { [MAIN_THREAD_ID]: [] },
    devices: { "dev-local": { id: "dev-local", name: "本机", os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux", isLocal: true, online: true } },
  };
}

export function createHub(_opts: { dataDir: string; now?: () => string }): Hub {
  const now = _opts.now ?? (() => new Date().toISOString());
  let model: HubModel = seedModel(now());
  const subs = new Set<(p: WirePush) => void>();
  let n = 0;

  return {
    get model() {
      return model;
    },
    snapshot(): Snapshot {
      return { ...snapshotOf(model), serverTime: now() };
    },
    commit(push: PushPayload): WirePush {
      model = { ...applyPush(model, push), seq: model.seq + 1 };
      const msg: WirePush = { type: "push", seq: model.seq, push };
      for (const s of subs) {
        try {
          s(msg);
        } catch (e) {
          console.error("[hub] subscriber failed", e);
        }
      }
      return msg;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    load(next) {
      model = next;
    },
    newId(prefix) {
      return `${prefix}-${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    },
    now,
  };
}
