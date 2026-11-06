// 原生 Bot 的扩展：内置编码工具（read/write/edit/bash）+ 写操作审批 + 角色提示。
import { defineExtension, hook, section, ToolTask, type ToolHookCall } from "@earendil-works/pi-durable";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import type { Risk } from "@muster/protocol";

/** 需要人工批准的工具及风险等级；read 直接放行。 */
const GUARDED: Record<string, Risk> = { write: "medium", edit: "medium", bash: "high", powershell: "high" };

const TITLES: Record<string, string> = { write: "写入文件", edit: "修改文件", bash: "运行命令", powershell: "运行命令" };

export interface ApprovalRequest {
  title: string;
  detail?: string;
  risk: Risk;
}

/** 按会话（conversation id）异步询问是否允许；返回 false 即拒绝。 */
export type Approver = (request: ApprovalRequest) => Promise<boolean>;

export const CODING_TOOLS = createCodingTools();

/** 所有原生 Bot 共用的通用约束；人设（bot.persona）另走会话的 instructions，渲染在其后。 */
export const NATIVE_INSTRUCTIONS = [
  "你是 Muster 里的内置 Bot，帮用户完成研究调研和办公任务。",
  "- 一律用中文回答，简洁直接。",
  "- 动手之前先用一两句话简述你的计划。",
  "- 写文件、改文件、执行命令前会弹出审批，需要用户同意后才会执行；被拒绝就换一种做法或说明原因，不要重复请求同一个操作。",
  "- 只使用已提供的工具；没有的能力直接告诉用户，不要假装做了。",
  "- 任务完成时给出简短总结：做了什么、结果在哪、还有什么需要用户决定。",
].join("\n");

/** 工具审批与角色提示；approverOf 返回会话当前的审批回调，没有则视为无人审批并拒绝。 */
export function createNativeExtension(approverOf: (conversationId: number) => Approver | undefined) {
  return defineExtension({
    name: "muster-native",
    sections: [section("muster", () => NATIVE_INSTRUCTIONS, { tag: false })],
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api) => {
          const risk = GUARDED[call.name];
          if (risk === undefined) return undefined;
          const approve = approverOf(api.conversationId);
          const allowed = approve ? await approve({ title: TITLES[call.name] ?? call.name, detail: describe(call), risk }) : false;
          return allowed ? undefined : { block: "用户拒绝了该操作" };
        },
      }),
    ],
  });
}

function describe(call: ToolHookCall): string | undefined {
  const args = call.arguments as { command?: unknown; path?: unknown; url?: unknown };
  const detail = args.command ?? args.path ?? args.url;
  return typeof detail === "string" ? detail : undefined;
}
