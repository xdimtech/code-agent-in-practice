// 内存里的假目录：演示和测试用，不碰真实磁盘。键是绝对路径，值是文件内容；links 里的路径当符号链接。

import { dirname } from "node:path";
import type { Entry, Fs } from "./find-text.ts";

export interface MemFs extends Fs {
  /** saveFull 存下的内容，按返回的路径索引 */
  readonly saved: ReadonlyMap<string, string>;
}

export function memFs(files: Readonly<Record<string, string>>, links: readonly string[] = [], failSave = false): MemFs {
  const dirs = new Set<string>();
  for (const f of [...Object.keys(files), ...links]) {
    for (let d = dirname(f); !dirs.has(d); d = dirname(d)) {
      dirs.add(d);
      if (d === dirname(d)) break;
    }
  }
  const saved = new Map<string, string>();
  const kind = (p: string): Entry["kind"] | undefined =>
    links.includes(p) ? "other" : p in files ? "file" : dirs.has(p) ? "dir" : undefined;
  const children = (dir: string): Entry[] =>
    [...new Set([...Object.keys(files), ...links, ...dirs].filter((p) => p !== dir && dirname(p) === dir))].map((p) => ({
      name: p.slice(dir.length + (dir.endsWith("/") ? 0 : 1)),
      kind: kind(p) as Entry["kind"],
    }));
  return {
    saved,
    stat: (p) => {
      const k = kind(p);
      return k ? { kind: k, size: k === "file" ? Buffer.byteLength(files[p], "utf8") : 0 } : undefined;
    },
    list: (dir) => {
      if (kind(dir) !== "dir") throw new Error(`ENOTDIR: ${dir}`);
      return children(dir);
    },
    read: (file) => {
      if (!(file in files)) throw new Error(`ENOENT: ${file}`);
      return files[file];
    },
    saveFull: (content) => {
      if (failSave) throw new Error("ENOSPC: no space left on device");
      const path = `/tmp/find-text-${saved.size + 1}/output.txt`;
      saved.set(path, content);
      return path;
    },
  };
}
