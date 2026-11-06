// OWNER: lead (do not edit). `pnpm daemon` -> tsx watch src/main.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "@muster/protocol";
import { startDaemon } from "./app";

const dataDir = process.env.MUSTER_DATA_DIR ?? join(homedir(), ".muster");
const d = await startDaemon({
  dataDir,
  port: Number(process.env.MUSTER_PORT ?? DEFAULT_PORT),
  token: process.env.MUSTER_TOKEN || undefined, // unset = dev mode, no auth (loopback only)
  fake: process.env.MUSTER_FAKE === "1",
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void d.stop().then(() => process.exit(0)));
