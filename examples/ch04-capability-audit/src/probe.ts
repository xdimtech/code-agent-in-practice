// 唯一碰外部世界的文件：找仓库根、跑 git grep、把输出解析成 Hit。

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import type { Hit } from "./classify.ts";
import type { Probe } from "./manifest.ts";

export class RepoError extends Error {}

/** 测试与第三方拷贝不算证据：一项能力「有」，必须有产品代码 */
const EXCLUDES = [":(exclude,glob)**/*.test.ts", ":(exclude,glob)**/test/**", ":(exclude,glob)**/vendor/**"];

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

/** `git grep -z -n` 的每一行是 file\0line\0text */
export function parseGrepOutput(out: string): Hit[] {
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const [file = "", line = "0", ...rest] = l.split("\0");
      return { file, line: Number(line), text: rest.join("\0").trim() };
    });
}

function isExitCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === code;
}

/**
 * 在仓库根上跑一次探针。git grep 没有命中时退出码是 1，那是正常结果；其他非零才是错误。
 * skip 是额外排除的目录（相对仓库根）——审计工具自己的清单里写满了探针字符串，不能拿自己当证据
 */
export function grepIn(root: string, skip: readonly string[] = []): (probe: Probe) => Hit[] {
  const excludes = [...EXCLUDES, ...skip.map((d) => `:(exclude,glob)${d}/**`)];
  return (probe) => {
    const flags = ["-z", "-n", "-I", "-E", ...(probe.ignoreCase ? ["-i"] : [])];
    const pathspecs = [...probe.paths.map((p) => `:(glob)${p}`), ...excludes];
    try {
      const out = execFileSync("git", ["-C", root, "grep", ...flags, "-e", probe.pattern, "--", ...pathspecs], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return parseGrepOutput(out);
    } catch (error) {
      if (isExitCode(error, 1)) return [];
      const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
      throw new RepoError(`探针「${probe.pattern}」执行失败：${stderr || String(error)}`);
    }
  };
}
