// 编排器抛出的业务错误；code 与线协议 WireError.code 对齐，server 层可直接映射。
import type { WireError } from "@muster/protocol";

export class OrchestratorError extends Error {
  readonly code: WireError["code"];

  constructor(code: WireError["code"], message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
