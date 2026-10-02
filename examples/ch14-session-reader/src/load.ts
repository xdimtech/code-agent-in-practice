// 本例碰磁盘的地方都在这里（另一处是 extension/record-provider.ts 的追加写）。
// 会话文件可能很大（图片内联），也可能是别人发来的，所以先查是不是普通文件、有多大。

import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./debug-vars.ts";
import type { FileProbe, Probe } from "./doctor.ts";
import type { Entry, SessionHeader } from "./types.ts";

export const MAX_BYTES = 64 * 1024 * 1024;

export class SessionFileError extends Error {}

export function readSessionFile(path: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new SessionFileError(`找不到会话文件：${path}`);
  }
  if (!stat.isFile()) throw new SessionFileError(`不是普通文件（符号链接也不跟随）：${path}`);
  if (stat.size > MAX_BYTES) throw new SessionFileError(`文件 ${stat.size} 字节，超过上限 ${MAX_BYTES}`);
  return readFileSync(path, "utf8");
}

/** 写脱敏后的副本；"wx" 保证不会覆盖已有文件，尤其是原文件 */
export function writeSessionCopy(path: string, header: SessionHeader, entries: readonly Entry[]): void {
  const text = [header, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n";
  try {
    writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new SessionFileError(code === "EEXIST" ? `目标已存在，不覆盖：${path}` : `写不进去：${path}（${code ?? "未知错误"}）`);
  }
}

/** 配置文件正常只有几 KB；超过这个数就不读内容，按解析失败处理 */
export const MAX_CONFIG_BYTES = 1024 * 1024;

function probeFile(path: string, readText: boolean): FileProbe {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw new SessionFileError(`查不了 ${path}（${(error as NodeJS.ErrnoException).code ?? "未知错误"}）`);
  }
  const base = { exists: true, mode: stat.mode & 0o777, size: stat.size };
  if (!readText || !stat.isFile() || stat.size > MAX_CONFIG_BYTES) return base;
  try {
    return { ...base, text: readFileSync(path, "utf8") };
  } catch (error) {
    throw new SessionFileError(`读不了 ${path}（${(error as NodeJS.ErrnoException).code ?? "未知错误"}）`);
  }
}

/** 给 doctor 用的环境快照。auth.json 只看在不在、权限是多少，不读内容 */
export function probe(env: Readonly<Record<string, string | undefined>>, home: string, nodeVersion: string, platform: string): Probe {
  const dir = agentDir(env, home);
  return {
    platform,
    nodeVersion,
    env,
    agentDir: dir,
    agentDirExists: probeFile(dir, false).exists,
    auth: probeFile(join(dir, "auth.json"), false),
    models: probeFile(join(dir, "models.json"), true),
    settings: probeFile(join(dir, "settings.json"), true),
    sessionsDir: probeFile(join(dir, "sessions"), false),
    debugLog: probeFile(join(dir, "pi-debug.log"), false),
    crashLog: probeFile(join(dir, "pi-crash.log"), false),
  };
}
