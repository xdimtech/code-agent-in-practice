// 本例唯一碰磁盘的模块：读一个包目录，交给纯函数去判断。
// 包目录是不可信输入：不跟随符号链接，跳过点开头的条目和 node_modules（与 collectFiles 的 package-manager.ts:327-328 一致），
// 并给文件数和深度设上限，免得一个恶意构造的目录把检查本身拖垮。

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PackageJsonError, parsePackageJson, type ParsedPackage } from "./package-json.ts";
import type { FileTree } from "./tree.ts";

export const MAX_FILES = 5_000;
export const MAX_DEPTH = 16;

export class PackageDirError extends Error {}

function walk(root: string, rel: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) throw new PackageDirError(`目录层级超过 ${MAX_DEPTH}：${rel}`);
  const entries = readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(root, path, depth + 1, out);
    else if (entry.isFile()) out.push(path);
    if (out.length > MAX_FILES) throw new PackageDirError(`文件数超过 ${MAX_FILES}`);
  }
}

export interface LoadedPackage {
  readonly parsed: ParsedPackage;
  readonly tree: FileTree;
}

export function loadPackageDir(dir: string): LoadedPackage {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    throw new PackageDirError(`找不到包目录：${dir}`);
  }
  if (!stat.isDirectory()) throw new PackageDirError(`不是目录（符号链接也不跟随）：${dir}`);
  let text: string;
  try {
    text = readFileSync(join(dir, "package.json"), "utf8");
  } catch {
    throw new PackageJsonError(`${dir} 下没有可读的 package.json`);
  }
  const files: string[] = [];
  walk(dir, "", 0, files);
  return { parsed: parsePackageJson(text), tree: files };
}

export function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new PackageDirError(`读不到文件：${path}`);
  }
}
