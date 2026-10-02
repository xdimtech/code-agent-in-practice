// 本例唯一读磁盘的地方：把一个目录变成「相对路径 → sha256」的清单，以及读单个文本文件。
// 不跟随符号链接，限制文件数和单文件大小——清单是拿来比对的，读到目录外面去就比错了东西。

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Manifest } from "./types.ts";

export class InputError extends Error {}

export const MAX_FILES = 20_000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", "dist"]);

export interface ManifestOptions {
  /** 只收这些扩展名（带点）。不给就全收 */
  readonly extensions?: readonly string[];
  readonly maxFiles?: number;
}

function statOf(path: string): ReturnType<typeof lstatSync> {
  try {
    return lstatSync(path);
  } catch {
    throw new InputError(`读不到 ${path}`);
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
      return entry.isFile() ? [full] : [];
    });
}

export function buildManifest(root: string, options: ManifestOptions = {}): Manifest {
  if (!statOf(root).isDirectory()) throw new InputError(`${root} 不是目录`);
  const wanted = (path: string): boolean => !options.extensions || options.extensions.some((ext) => path.endsWith(ext));
  const files = walk(root).filter(wanted);
  const limit = options.maxFiles ?? MAX_FILES;
  if (files.length > limit) throw new InputError(`${root} 下有 ${files.length} 个文件，超过上限 ${limit}`);
  return new Map(
    files.map((full) => {
      if (statOf(full).size > MAX_FILE_BYTES) throw new InputError(`${full} 超过 ${MAX_FILE_BYTES} 字节`);
      const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
      return [relative(root, full).split(sep).join("/"), digest] as const;
    }),
  );
}

export function readText(path: string): string {
  const stat = statOf(path);
  if (!stat.isFile()) throw new InputError(`${path} 不是普通文件`);
  if (stat.size > MAX_FILE_BYTES) throw new InputError(`${path} 超过 ${MAX_FILE_BYTES} 字节`);
  return readFileSync(path, "utf8");
}

/** 路径存不存在。符号链接算存在（不去看它指向哪） */
export function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
