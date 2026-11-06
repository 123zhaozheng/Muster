// OWNER: B8 / N1. 原生（内置）Bot：基于 @earendil-works/pi-durable，同时是 pi-durable 作为内核的可行性验证。
// 全部 session 共用一个 Harness（dataDir/native.db，SQLite）；一个 session = 一个 ownerless conversation，nativeId = conversation id。
//
// 二期：模型来自 ModelService（用户在设置里配置）。Harness 的 `models` 传函数 `() => Models`，每次请求都取当前配置，
// 所以配置变化后无需重开 Harness：运行中的请求不受影响，下一次请求（含已有会话）即用新配置。
// 会话选用的模型在每次 send 前核对（ensureModel）：bot.model > opts.model > 设置里的原生默认；变了就 configure 切换。
// 人设走会话的 instructions（渲染在通用约束之后），工具按 bot.tools 分组用 agent.tools 过滤。
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type AgentChange, type Conversation, type ConversationId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Bot } from "@muster/protocol";
import type { AgentDriver, DriverSession, ModelService, StartSessionOpts } from "../../core/contracts";
import { CODING_TOOLS, createNativeExtension, type Approver } from "./extension";
import { resolveNativeModel, type NativeModelRef } from "./model";
import { NativeSession, type SessionHost } from "./session";
import { NATIVE_TOOLS, toolsForGroups } from "./tools";

const context = BACKGROUND_CONTEXT;

export interface NativeDriverOptions {
  dataDir?: string;
  /** 直接给定模型来源（测试用 faux provider）；仅在没有 modelService 时使用。 */
  modelSource?: { models: Models; model: NativeModelRef };
  /** 没有 modelService / modelSource 时，从环境变量解析（MUSTER_NATIVE_*）；解析不出来就视为未配置，不抛错。 */
  env?: NodeJS.ProcessEnv;
  /** phase 2：用户配置的模型；优先于 modelSource/env。未配置模型时不会抛错，该轮以清晰提示失败（error: "no_model"）。 */
  modelService?: ModelService;
}

/** 驱动本体；close() 关闭共享的 Harness（未完成的运行保持原状，下次打开可继续）。 */
export type NativeDriver = AgentDriver & { close(): Promise<void> };

/** 模型来源：当前可用的 Models，以及某个 Bot 该用哪个模型（undefined = 没有可用模型）。 */
interface ModelSource {
  models(): Models;
  resolve(ref: NativeModelRef | undefined, legacyModelId: string | undefined): NativeModelRef | undefined;
}

function serviceSource(service: ModelService): ModelSource {
  return {
    models: () => service.models(),
    resolve(ref, legacyModelId) {
      const resolved = service.resolve(ref, "native");
      if (ref || !legacyModelId || !resolved) return resolved;
      // 兼容一期的 opts.model（只有 modelId）：在默认 provider 下找得到才用。
      return service.models().getModel(resolved.provider, legacyModelId) ? { provider: resolved.provider, modelId: legacyModelId } : resolved;
    },
  };
}

function staticSource(setup: { models: Models; model: NativeModelRef } | undefined): ModelSource {
  const models = setup?.models ?? createModels();
  return {
    models: () => models,
    resolve(ref, legacyModelId) {
      if (!setup) return undefined;
      if (ref && models.getModel(ref.provider, ref.modelId)) return ref;
      if (legacyModelId && models.getModel(setup.model.provider, legacyModelId)) return { provider: setup.model.provider, modelId: legacyModelId };
      return setup.model;
    },
  };
}

function envSetup(env: NodeJS.ProcessEnv | undefined) {
  try {
    return resolveNativeModel(env);
  } catch {
    return undefined; // 未配置：不抛错，start 时给用户提示
  }
}

/** 人设 + 名字 → 会话 instructions；都没有则不设置。 */
function instructionsOf(bot: Bot | undefined): string | undefined {
  const parts = [bot?.name ? `你的名字是「${bot.name}」。` : "", bot?.persona?.trim() ?? ""].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

export function createNativeDriver(o: NativeDriverOptions = {}): NativeDriver {
  const source = o.modelService ? serviceSource(o.modelService) : staticSource(o.modelSource ?? envSetup(o.env));
  const dbPath = join(o.dataDir ?? ".", "native.db");
  const approvers = new Map<number, Approver>();

  /** 每次 start 一个 host：带上这个 Bot 的模型偏好；fork 出的子会话沿用它。 */
  const hostFor = (bot: Bot | undefined, legacyModelId: string | undefined): SessionHost => ({
    registerApprover(conversationId, approver) {
      approvers.set(conversationId, approver);
      return () => approvers.delete(conversationId);
    },
    async ensureModel(conversation: Conversation) {
      const ref = source.resolve(bot?.model, legacyModelId);
      if (!ref) return false;
      const current = (await conversation.agent(context)).model;
      if (current?.provider !== ref.provider || current.modelId !== ref.modelId) await conversation.configure({ model: ref }, context);
      return true;
    },
  });

  const registry = createRegistry();
  registry.install(CODING_TOOLS);
  registry.install(NATIVE_TOOLS);
  registry.install(createNativeExtension((id) => approvers.get(id)));

  let harnessPromise: Promise<Harness> | undefined;
  const getHarness = () =>
    (harnessPromise ??= (async () => {
      await mkdir(o.dataDir ?? ".", { recursive: true });
      return Harness.open(
        await openNodeSqliteStorage(dbPath),
        {
          models: () => source.models(),
          registry,
          env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
          // 失败的运行不要卡住后面排队的消息；模型请求失败（401/网络）最多重试两次就报给用户。
          settings: { afterFailedRun: "continue", retry: { maxRetries: 2, baseDelayMs: 500 } },
          onReport: (report) => console.warn("[native]", report.kind, report.error),
        },
        context,
      );
    })());

  return {
    kind: "native",
    async detect() {
      return { engine: "other", command: "pi-durable", found: true };
    },
    async start(opts: StartSessionOpts): Promise<DriverSession> {
      const harness = await getHarness();
      const { bot } = opts;
      const host = hostFor(bot, opts.model);
      if (opts.resumeNativeId) {
        const conversation = await harness.conversation(Number(opts.resumeNativeId) as ConversationId, context);
        if (!conversation) throw new Error(`原生会话不存在：${opts.resumeNativeId}`);
        // 成员的人设/工具可能在两次运行之间被编辑过：带着 bot 恢复就刷新会话里存的配置。
        if (bot) await conversation.configure({ instructions: instructionsOf(bot) ?? null, tools: toolsForGroups(bot.tools) }, context);
        const session = await NativeSession.attach(host, conversation);
        harness.resume(); // 继续上次进程中断的运行（先挂好 watch 再恢复，避免漏事件）
        return session;
      }
      const ref = source.resolve(bot?.model, opts.model);
      const agent: AgentChange = {
        cwd: opts.cwd,
        ...(ref ? { model: ref } : {}),
        ...(instructionsOf(bot) ? { instructions: instructionsOf(bot) } : {}),
        tools: toolsForGroups(bot?.tools),
      };
      const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, context);
      const session = await NativeSession.attach(host, conversation);
      await session.send(opts.prompt, "normal");
      return session;
    },
    async close() {
      if (!harnessPromise) return;
      const harness = await harnessPromise;
      harnessPromise = undefined;
      await harness.close(context);
    },
  };
}
