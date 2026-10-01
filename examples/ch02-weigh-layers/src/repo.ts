// 唯一碰外部世界的文件：问 git 要跟踪的文件清单，再逐个读字节数行。

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { countLines, isCountedSource } from "./filter.ts";
import type { SourceFile } from "./layers.ts";

export class RepoError extends Error {}

export interface Weighed {
  readonly root: string;
  readonly files: readonly SourceFile[];
  /** git 跟踪了、但工作区里读不到的文件（被删未提交、断掉的符号链接） */
  readonly unreadable: readonly string[];
}

/** 给的是仓库里任意一个目录，返回仓库根——总是称整个仓库，路径才和全书的引用对得上 */
export function repoRoot(dir: string): string {
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    throw new RepoError(`路径不存在：${dir}`);
  }
  if (!isDir) throw new RepoError(`不是目录：${dir}`);
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new RepoError(`不在 git 仓库里（或没装 git）：${dir}`);
  }
}

/** 路径相对仓库根；与在仓库根执行 `git ls-files` 的输出一致 */
export function listTracked(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 256 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter((p) => p.length > 0);
}

export function weighRepo(dir: string): Weighed {
  const root = repoRoot(dir);
  const files: SourceFile[] = [];
  const unreadable: string[] = [];
  for (const path of listTracked(root).filter(isCountedSource)) {
    try {
      files.push({ path, lines: countLines(readFileSync(join(root, path))) });
    } catch {
      unreadable.push(path);
    }
  }
  return { root, files, unreadable };
}
