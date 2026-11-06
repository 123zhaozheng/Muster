// 基于文件的 pi-ai CredentialStore（dataDir/credentials.json）与原子写 JSON 工具。密钥只在这里落盘，永不外发。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { rename, writeFile, mkdir, unlink } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/** 原子写 JSON：先写临时文件，（Windows 上）限制为仅当前用户可访问，再 rename 覆盖。 */
export async function writeJsonAtomic(file: string, value: unknown, opts: { secret?: boolean } = {}): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    if (opts.secret) await restrictToCurrentUser(tmp);
    await renameWithRetry(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Windows 上 rename 覆盖偶尔会被杀毒/索引器短暂占用（EPERM/EBUSY），重试几次。 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

/** Windows：去掉继承并只授权当前用户（尽力而为，失败不影响功能）。POSIX 已由 mode 0600 保证。 */
function restrictToCurrentUser(file: string): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const domain = process.env.USERDOMAIN;
  const name = userInfo().username;
  const who = domain ? `${domain}\\${name}` : name;
  const run = (args: string[]) =>
    new Promise<boolean>((resolve) => {
      execFile("icacls", args, { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
    });
  // 先授权再去继承：授权失败时保持原 ACL，避免把自己锁在外面。
  return run([file, "/grant:r", `${who}:F`]).then(async (granted) => {
    if (granted) await run([file, "/inheritance:r"]);
  });
}

/** 同步读 JSON；不存在返回 undefined，损坏则改名备份后返回 undefined。 */
export function readJsonSync(file: string): unknown {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // 文件损坏：留档后当作空（不删除，方便用户找回）。不记录内容，避免泄密。
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    console.warn(`[models] ${file} 无法解析，已改名备份，按空配置启动`);
    return undefined;
  }
}

export interface FileCredentialStore extends CredentialStore {
  /** 同步查询：该 provider 是否存有 api key（给 hasApiKey 用）。 */
  hasApiKey(providerId: string): boolean;
  /** 同步读取 key（仅供本进程内的错误脱敏用，不得外发）。 */
  peekKey(providerId: string): string | undefined;
}

/** 内存缓存 + 文件持久化；所有写操作串行并原子落盘。 */
export function createFileCredentialStore(file: string): FileCredentialStore {
  mkdirSync(dirname(file), { recursive: true });
  const raw = readJsonSync(file);
  const data = new Map<string, Credential>(
    raw && typeof raw === "object" ? Object.entries(raw as Record<string, Credential>).filter(([, c]) => c && typeof c === "object") : [],
  );
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const persist = () => writeJsonAtomic(file, Object.fromEntries(data), { secret: true });

  return {
    async read(providerId: string, _o?: AuthOperationOptions) {
      const c = data.get(providerId);
      return c ? structuredClone(c) : undefined;
    },
    async list(_o?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
      return [...data].map(([providerId, c]) => ({ providerId, type: c.type }));
    },
    modify(providerId, fn, _o) {
      return serial(async () => {
        const current = data.get(providerId);
        const next = await fn(current ? structuredClone(current) : undefined);
        if (next === undefined) return current;
        const before = current;
        data.set(providerId, next);
        try {
          await persist();
        } catch (e) {
          if (before) data.set(providerId, before);
          else data.delete(providerId);
          throw e;
        }
        return structuredClone(next);
      });
    },
    delete(providerId, _o) {
      return serial(async () => {
        const before = data.get(providerId);
        if (!before) return;
        data.delete(providerId);
        try {
          await persist();
        } catch (e) {
          data.set(providerId, before);
          throw e;
        }
      });
    },
    hasApiKey(providerId) {
      const c = data.get(providerId);
      return c?.type === "api_key" && !!c.key;
    },
    peekKey(providerId) {
      const c = data.get(providerId);
      return c?.type === "api_key" ? c.key : undefined;
    },
  };
}
