// 包内文件树上的发现规则。输入是包根下所有文件的 POSIX 相对路径（已跳过点开头的段和 node_modules，
// 与 collectFiles 的 package-manager.ts:327-328 一致），这样规则本身是纯函数，可以不碰磁盘测试。

import { posix } from "node:path";
import type { ResourceType } from "./package-json.ts";

export type FileTree = readonly string[];

export function isFile(tree: FileTree, path: string): boolean {
  return tree.includes(path);
}

export function isDir(tree: FileTree, path: string): boolean {
  return path === "." || tree.some((f) => f.startsWith(`${path}/`));
}

/** 一层目录内容，按字典序。 */
export function listDir(tree: FileTree, dir: string): { readonly files: readonly string[]; readonly dirs: readonly string[] } {
  const prefix = dir === "." ? "" : `${dir}/`;
  const rests = tree.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const files = rests.filter((r) => !r.includes("/"));
  const dirs = [...new Set(rests.filter((r) => r.includes("/")).map((r) => r.split("/")[0] ?? ""))];
  return { files: [...files].sort(), dirs: dirs.sort() };
}

const join = (dir: string, name: string) => (dir === "." ? name : posix.join(dir, name));

/** 目录里有 index.ts 或 index.js 就只认它（resolveExtensionEntries，:557-585；本例不处理子目录自己的 package.json）。 */
function extensionIndex(tree: FileTree, dir: string): string | undefined {
  return ["index.ts", "index.js"].map((n) => join(dir, n)).find((p) => isFile(tree, p));
}

/** collectAutoExtensionEntries（:587-639）：顶层 .ts/.js 文件，加上能解析出入口的子目录。 */
function collectExtensions(tree: FileTree, dir: string): string[] {
  const root = extensionIndex(tree, dir);
  if (root) return [root];
  const { files, dirs } = listDir(tree, dir);
  const top = files.filter((f) => f.endsWith(".ts") || f.endsWith(".js")).map((f) => join(dir, f));
  const nested = dirs.flatMap((d) => extensionIndex(tree, join(dir, d)) ?? []);
  return [...top, ...nested];
}

/** collectSkillEntries 的 "pi" 模式（:365-442）：有 SKILL.md 的目录算一个技能、不再往下走；根目录下的 .md 也算。 */
function collectSkills(tree: FileTree, dir: string, root = dir): string[] {
  const { files, dirs } = listDir(tree, dir);
  if (files.includes("SKILL.md")) return [join(dir, "SKILL.md")];
  const loose = dir === root ? files.filter((f) => f.endsWith(".md")).map((f) => join(dir, f)) : [];
  return [...loose, ...dirs.flatMap((d) => collectSkills(tree, join(dir, d), root))];
}

const SUFFIX: Readonly<Record<"prompts" | "themes", string>> = { prompts: ".md", themes: ".json" };

/** 某类资源在一个目录下的全部文件（collectResourceFiles，:645-653）。 */
export function collectResourceFiles(tree: FileTree, dir: string, type: ResourceType): readonly string[] {
  if (!isDir(tree, dir)) return [];
  if (type === "extensions") return collectExtensions(tree, dir);
  if (type === "skills") return collectSkills(tree, dir);
  const prefix = dir === "." ? "" : `${dir}/`;
  return tree.filter((f) => f.startsWith(prefix) && f.endsWith(SUFFIX[type])).sort();
}

/** 清单里一条非 glob 的路径：文件就是它，目录就按类型发现，不存在就跳过（collectFilesFromPaths，:2518-2535）。 */
export function collectFromPath(tree: FileTree, path: string, type: ResourceType): readonly string[] {
  const normalized = posix.normalize(path).replace(/\/$/, "");
  if (isFile(tree, normalized)) return [normalized];
  return collectResourceFiles(tree, normalized, type);
}

/** glob 条目只展开可见路径，按字典序（expandPackageGlob，:288-297）。 */
export function expandGlob(tree: FileTree, pattern: string): readonly string[] {
  const normalized = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  const dirs = [...new Set(tree.flatMap((f) => f.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))))];
  return [...tree, ...dirs].filter((p) => posix.matchesGlob(p, normalized)).sort();
}
