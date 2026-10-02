// 本例唯一读盘的地方：策略文件。它们决定什么命令能跑，所以读之前先确认是普通文件、大小正常。

import { lstatSync, readFileSync } from "node:fs";
import { PolicyFormatError, parseOverlayText } from "./policy-file.ts";
import type { PolicyOverlay } from "./types.ts";

/** 策略文件正常只有几百字节 */
export const MAX_POLICY_BYTES = 64 * 1024;

export function readOverlay(path: string): PolicyOverlay {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new PolicyFormatError(`找不到策略文件：${path}`);
  }
  if (!stat.isFile()) throw new PolicyFormatError(`不是普通文件（符号链接也不跟随）：${path}`);
  if (stat.size > MAX_POLICY_BYTES) throw new PolicyFormatError(`策略文件 ${stat.size} 字节，超过上限 ${MAX_POLICY_BYTES}`);
  return parseOverlayText(readFileSync(path, "utf8"), path);
}
