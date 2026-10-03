// pi 扩展：注册 find_text。用法：
//   pi -e ./extension/find-text.ts
// 工具本身在 src/find-text.ts；这里只把真实的文件系统接上去。没有对真实的 pi 跑过，只对假 pi 测过（extension/find-text.test.ts）。
// 参数 schema 是普通 JSON Schema，不是 TypeBox：pi 的校验对非 TypeBox schema 走另一条转换路径（ai/src/utils/validation.ts:323-335），
// 所以本例不依赖 typebox。代价是 Google 系模型那边的兼容性没有验证过（docs/extensions.md:2029 建议枚举用 StringEnum）。
// pi 的类型只写了用到的成员；真实签名见 core/extensions/types.ts:451-500。

import { lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFindTextTool, type Entry, type Fs } from "../src/find-text.ts";
import type { ToolDef } from "../src/types.ts";

interface Pi {
  registerTool(tool: ToolDef): void;
}

const kindOf = (d: { isFile(): boolean; isDirectory(): boolean }): Entry["kind"] => (d.isFile() ? "file" : d.isDirectory() ? "dir" : "other");

export const nodeFs: Fs = {
  stat: (path) => {
    try {
      const st = lstatSync(path);
      return { kind: kindOf(st), size: st.size };
    } catch {
      return undefined;
    }
  },
  list: (dir) => readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, kind: kindOf(d) })),
  read: (file) => readFileSync(file, "utf8"),
  saveFull: (content) => {
    const file = join(mkdtempSync(join(tmpdir(), "pi-find-text-")), "output.txt");
    writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
    return file;
  },
};

export function createExtension(fs: Fs): (pi: Pi) => void {
  return (pi) => pi.registerTool(createFindTextTool(fs));
}

export default (pi: Pi): void => createExtension(nodeFs)(pi);
