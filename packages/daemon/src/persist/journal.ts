// OWNER: B1. Durable snapshot journal of the hub model (node:sqlite, JSONL file fallback) + restore on startup.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { emptyModel, type HubModel } from "@muster/protocol/reducer";
import type { Hub } from "../core/contracts";

const THROTTLE_MS = 500;
const KEY = "model";

interface Store {
  read(): string | undefined;
  write(json: string): void;
  close(): void;
}

function sqliteStore(file: string): Store | undefined {
  let DatabaseSyncCtor: typeof DatabaseSync;
  try {
    DatabaseSyncCtor = (createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
  } catch {
    return undefined; // Node without node:sqlite
  }
  const db = new DatabaseSyncCtor(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const get = db.prepare("SELECT value FROM kv WHERE key = ?");
  const put = db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
  return {
    read: () => (get.get(KEY) as { value: string } | undefined)?.value,
    write: (json) => void put.run(KEY, json, new Date().toISOString()),
    close: () => db.close(),
  };
}

/** One-line JSON file, replaced atomically (write temp + rename). */
function jsonlStore(file: string): Store {
  return {
    read() {
      try {
        return readFileSync(file, "utf8").trim() || undefined;
      } catch {
        return undefined;
      }
    },
    write(json) {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, json + "\n");
      renameSync(tmp, file);
    },
    close() {},
  };
}

function parseModel(json: string): HubModel | undefined {
  try {
    const m = JSON.parse(json) as Partial<HubModel> | null;
    if (!m || typeof m !== "object" || typeof m.seq !== "number" || !m.bots || !m.threads) return undefined;
    return { ...emptyModel(), ...m }; // fill collections added after the snapshot was written
  } catch {
    return undefined;
  }
}

/**
 * Restores the last persisted model into `hub` (call before the server starts) and keeps persisting:
 * every push marks the model dirty and a throttled timer writes the whole model; close() flushes synchronously.
 * `seq` is persisted with the model, so pushes after a restart stay monotonic.
 */
export function attachJournal(hub: Hub, o: { dataDir: string }): { close(): void } {
  mkdirSync(o.dataDir, { recursive: true });
  const store = sqliteStore(join(o.dataDir, "muster.db")) ?? jsonlStore(join(o.dataDir, "muster.jsonl"));

  const saved = store.read();
  if (saved) {
    const model = parseModel(saved);
    if (model) hub.load(model);
    else console.warn("[journal] 快照损坏，已忽略，使用默认状态");
  }

  let dirty = false;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    try {
      store.write(JSON.stringify(hub.model));
    } catch (e) {
      dirty = true;
      console.error("[journal] 写入失败", e);
    }
  };

  const unsubscribe = hub.subscribe(() => {
    if (closed) return;
    dirty = true;
    timer ??= setTimeout(flush, THROTTLE_MS);
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      flush();
      store.close();
    },
  };
}
