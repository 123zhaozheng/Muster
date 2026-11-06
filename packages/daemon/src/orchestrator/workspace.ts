// 工作目录准备：git worktree 创建/清理、空工作区目录。
import { execFile } from "node:child_process";
import { realpath as realpathCb } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
/** 解析符号链接与 Windows 8.3 短路径，便于比较路径。 */
const realpath = promisify(realpathCb.native);

/** 运行 git 并返回 trim 后的 stdout；失败时抛出带 stderr 的 Error。 */
export async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error((err.stderr || err.message || "git 执行失败").trim());
  }
}

export interface Worktree {
  /** 任务实际工作目录（若 fromDir 是仓库子目录，则为 worktree 内的对应子目录）。 */
  cwd: string;
  branch: string;
  /** worktree 根目录。 */
  root: string;
}

/** 以 fromDir 当前 HEAD 为基点，新建分支 branch 并检出到 worktreePath。 */
export async function createWorktree(fromDir: string, worktreePath: string, branch: string): Promise<Worktree> {
  const top = await realpath(await git(["rev-parse", "--show-toplevel"], fromDir));
  const from = await realpath(fromDir);
  let rel = path.relative(top, from);
  if (rel.startsWith("..") || path.isAbsolute(rel)) rel = "";
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(["worktree", "add", "-b", branch, worktreePath, "HEAD"], fromDir);
  return { cwd: rel ? path.join(worktreePath, rel) : worktreePath, branch, root: worktreePath };
}

/** 尽力清理（启动会话失败时回滚），不抛错。 */
export async function removeWorktree(fromDir: string, worktreePath: string, branch: string): Promise<void> {
  await git(["worktree", "remove", "--force", worktreePath], fromDir).catch(() => {});
  await git(["branch", "-D", branch], fromDir).catch(() => {});
}

export async function makeEmptyDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** 复制 src 目录内容到 dest（用于分叉“无仓库”的临时工作区）。 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
}

/** child 是否位于 parent 之内（路径纯字符串判断）。 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** 由任务 id 派生短分支名后缀。 */
export const shortId = (taskId: string): string => taskId.replace(/^task-/, "").slice(-8);
