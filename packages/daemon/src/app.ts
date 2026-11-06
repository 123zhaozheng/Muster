// OWNER: lead (do not edit). Composition root.
import { DEFAULT_PORT, MAIN_THREAD_ID } from "@muster/protocol";
import type { MethodName } from "@muster/protocol";
import { createHub } from "./core/hub";
import type { DriverRegistry, Handlers, Orchestrator, Router } from "./core/contracts";
import { startServer } from "./server/server";
import { createMiscHandlers } from "./handlers/misc";
import { attachJournal } from "./persist/journal";
import { createFakeDriver } from "./drivers/fake";
import { createCodexDriver } from "./drivers/codex";
import { createClaudeDriver } from "./drivers/claude";
import { createNativeDriver } from "./drivers/native";
import { createOrchestrator } from "./orchestrator";
import { createRouter } from "./router";
import { createTriggers } from "./triggers";
import { createModelService } from "./models/service";

const ALL_METHODS: MethodName[] = [
  "hub.snapshot", "thread.get", "chat.send", "task.interrupt", "task.cancel", "task.fork", "task.branches",
  "branch.adopt", "approval.resolve", "trigger.list", "trigger.upsert", "trigger.delete", "trigger.fire",
  "event.list", "bot.detectAgents", "bot.add", "device.list", "device.pairCode",
  "bot.update", "bot.remove", "model.catalog", "model.providers", "model.providerUpsert", "model.providerDelete",
  "model.list", "model.test", "model.settingsSet",
];

export async function startDaemon(o: { dataDir: string; port?: number; token?: string; fake?: boolean }) {
  const hub = createHub({ dataDir: o.dataDir });
  const journal = attachJournal(hub, { dataDir: o.dataDir });
  // phase 2: user-configured models (settings → 模型). Env vars stay as a fallback inside the service.
  const modelService = createModelService({ hub, dataDir: o.dataDir });

  const drivers: DriverRegistry = new Map();
  if (o.fake) {
    for (const k of ["codex", "claude", "native"] as const) drivers.set(k, createFakeDriver(k));
  } else {
    drivers.set("codex", createCodexDriver());
    drivers.set("claude", createClaudeDriver());
    // Native bots always run on pi-durable; without a configured model a turn fails with a clear hint.
    drivers.set("native", createNativeDriver({ dataDir: o.dataDir, modelService }));
  }

  let router!: Router;
  let orchestrator!: Orchestrator;
  orchestrator = createOrchestrator({ hub, drivers, dataDir: o.dataDir, getRouter: () => router });
  router = createRouter({ hub, orchestrator: () => orchestrator, modelService: o.fake ? undefined : modelService });
  const triggers = createTriggers({ hub, orchestrator: () => orchestrator, dataDir: o.dataDir });

  const handlers: Handlers = {
    ...createMiscHandlers({ hub, drivers }),
    ...modelService.handlers,
    ...orchestrator.handlers,
    ...triggers.handlers,
    "chat.send": async (p) => {
      const mode = p.mode ?? "normal";
      const entryId =
        p.threadId === MAIN_THREAD_ID
          ? await router.handleUserMessage(p.text)
          : await orchestrator.sendToThread(p.threadId, p.text, mode);
      return { entryId };
    },
  };
  for (const m of ALL_METHODS) if (!handlers[m]) console.warn(`[musterd] handler missing: ${m}`);

  await orchestrator.recover();
  await triggers.start();
  const server = await startServer({ hub, handlers, port: o.port ?? DEFAULT_PORT, token: o.token });
  console.log(`[musterd] listening on ws://127.0.0.1:${server.port}/ws (fake=${!!o.fake})`);

  return {
    port: server.port,
    async stop() {
      await triggers.stop();
      await orchestrator.shutdown();
      await server.close();
      journal.close();
    },
  };
}
