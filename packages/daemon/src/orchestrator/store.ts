// 编排器自己的持久化：taskId -> 引擎原生会话 id + 每个 turn 的末尾 entry id（用于重启后恢复与 fork 定位）。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TaskPersist {
  nativeId: string;
  /** turn 序号 -> 该 turn 最后一个 entry id。 */
  turns: Record<string, string>;
}

interface FileShape {
  version: 1;
  tasks: Record<string, TaskPersist>;
}

export interface OrchestratorStore {
  /** 读取磁盘内容（与内存中已有项合并，内存优先）。只需在启动恢复时调用。 */
  load(): Promise<void>;
  get(taskId: string): TaskPersist | undefined;
  set(taskId: string, value: TaskPersist): void;
  /** 等待所有排队的写盘完成。 */
  flush(): Promise<void>;
}

export function createStore(file: string): OrchestratorStore {
  const tasks = new Map<string, TaskPersist>();
  let chain: Promise<void> = Promise.resolve();

  const write = async (): Promise<void> => {
    const body: FileShape = { version: 1, tasks: Object.fromEntries(tasks) };
    const text = JSON.stringify(body, null, 2);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    try {
      await writeFile(tmp, text, "utf8");
      await rename(tmp, file);
    } catch {
      await writeFile(file, text, "utf8");
    }
  };

  const schedule = (): void => {
    chain = chain.then(write).catch((e) => console.warn("[orchestrator] 写入 orchestrator.json 失败:", (e as Error).message));
  };

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<FileShape>;
        for (const [id, v] of Object.entries(parsed.tasks ?? {})) if (!tasks.has(id)) tasks.set(id, v);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[orchestrator] 读取 orchestrator.json 失败:", (e as Error).message);
      }
    },
    get: (taskId) => tasks.get(taskId),
    set(taskId, value) {
      tasks.set(taskId, value);
      schedule();
    },
    flush: () => chain,
  };
}
