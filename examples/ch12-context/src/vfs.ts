import { posix } from "node:path";
import type { Vfs } from "./types.ts";

export const { dirname, basename, join } = posix;

export function isFile(fs: Vfs, path: string): boolean {
  return fs.has(path);
}

export function isDir(fs: Vfs, path: string): boolean {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  for (const key of fs.keys()) if (key.startsWith(prefix)) return true;
  return false;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: "file" | "dir";
}

/** 列出目录的直接子项，按名字排序，保证在任何机器上遍历顺序一致。 */
export function readdir(fs: Vfs, dir: string): readonly DirEntry[] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const entries = new Map<string, DirEntry["kind"]>();
  for (const key of fs.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (name) entries.set(name, slash === -1 ? (entries.get(name) ?? "file") : "dir");
  }
  return [...entries].map(([name, kind]) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name));
}

export function readFile(fs: Vfs, path: string): string {
  const content = fs.get(path);
  if (content === undefined) throw new Error(`文件不存在：${path}`);
  return content;
}
