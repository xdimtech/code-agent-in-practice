// 本例读写磁盘的地方都在这里。审计日志、锚点、会话文件都是外部输入：先 lstat，只认普通文件，限制大小。

import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import type { FileDigest } from "./records.ts";
import { InputError } from "./types.ts";
import type { LogIo } from "./writer.ts";

export const MAX_LOG_BYTES = 256 * 1024 * 1024;
export const MAX_SESSION_BYTES = 256 * 1024 * 1024;
export const MAX_ANCHOR_BYTES = 4 * 1024;
/** 给完整输出文件算摘要的上限；pi 的 bash 输出可能很大，超过只记大小 */
export const MAX_DIGEST_BYTES = 64 * 1024 * 1024;

const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === "ENOENT";

function statRegular(path: string, max: number): number {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new InputError(`不是普通文件（符号链接也不跟随）：${path}`);
  if (stat.size > max) throw new InputError(`${path} 有 ${stat.size} 字节，超过上限 ${max}`);
  return stat.mode;
}

export function readRegular(path: string, max: number): string {
  try {
    statRegular(path, max);
  } catch (e) {
    if (isMissing(e)) throw new InputError(`找不到文件：${path}`);
    throw e;
  }
  return readFileSync(path, "utf8");
}

/** 审计日志的读写口子。别人也能写的日志文件不接着写：谁都能改，链再完整也证明不了什么 */
export function fileIo(path: string): LogIo {
  return {
    read() {
      let mode: number;
      try {
        mode = statRegular(path, MAX_LOG_BYTES);
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw e;
      }
      if (process.platform !== "win32" && (mode & 0o022) !== 0) throw new InputError(`${path} 的权限是 ${(mode & 0o777).toString(8)}，组或其他用户可写`);
      return readFileSync(path, "utf8");
    },
    append: (text) => appendFileSync(path, text, { mode: 0o600 }),
  };
}

export function fileDigest(path: string): FileDigest {
  try {
    statRegular(path, MAX_DIGEST_BYTES);
    const data = readFileSync(path);
    return { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  } catch (e) {
    return { error: isMissing(e) ? "文件已经不在了" : e instanceof Error ? e.message : String(e) };
  }
}
