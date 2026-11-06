// OWNER: B1. Error type handlers can throw to control the WireError.code the client sees.
import type { WireError } from "@muster/protocol";

export class HandlerError extends Error {
  constructor(
    readonly code: WireError["code"],
    message: string,
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

const CODES: ReadonlySet<string> = new Set<WireError["code"]>(["bad_request", "not_found", "conflict", "busy", "unsupported", "internal"]);

/** Map any thrown value to a WireError; an error object carrying a valid `code` keeps it. */
export function toWireError(e: unknown): WireError {
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  return { code: typeof code === "string" && CODES.has(code) ? (code as WireError["code"]) : "internal", message };
}
