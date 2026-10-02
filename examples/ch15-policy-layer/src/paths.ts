// 写入路径的两条规则：必须落在 writeRoots 里；不能碰 protectedPaths。
// 这里只做字面上的路径运算，不读磁盘：符号链接会把一个看起来在工作区里的路径指到外面去，
// 要防这个得在执行那一刻用 realpath 再查一次，而且查和写之间仍有时间差——那是沙箱的活。

import { isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";
import type { Policy } from "./types.ts";

export type PathCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly rule: "outside-write-roots" | "protected-path"; readonly detail: string };

/** target 是否在 root 里（含 root 本身）；两个都要是绝对路径 */
export const inside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export function checkWrite(policy: Pick<Policy, "writeRoots" | "protectedPaths">, cwd: string, target: string): PathCheck {
  // ~ 要 shell 或工具去展开，展开后一定在家目录下；本例不替它展开，直接按工作区外处理
  if (target.startsWith("~")) return { ok: false, rule: "outside-write-roots", detail: `${target} 在家目录下` };
  const absolute = resolve(cwd, target);
  if (!policy.writeRoots.some((root) => inside(resolve(cwd, root), absolute))) {
    return { ok: false, rule: "outside-write-roots", detail: `${absolute} 不在可写目录里` };
  }
  // 按路径段比，不按子串比；转小写是因为 macOS 和 Windows 默认的文件系统不分大小写，.ENV 和 .env 是同一个文件
  const segments = relative(cwd, absolute).split(sep).map((s) => s.toLowerCase());
  const hit = policy.protectedPaths.find((pattern) => segments.some((s) => matchesGlob(s, pattern.toLowerCase())));
  return hit === undefined ? { ok: true } : { ok: false, rule: "protected-path", detail: `${target} 命中受保护的 ${hit}` };
}
