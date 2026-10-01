import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createExtensionAPI } from "./api.ts";
import type { EventBus, Extension, ExtensionFactory, FlagValue } from "./types.ts";

export class LoadError extends Error {
  readonly path: string;
  constructor(path: string, message: string, options?: ErrorOptions) {
    super(`${path}：${message}`, options);
    this.name = "LoadError";
    this.path = path;
  }
}

const EXTENSION_FILE = new Set([".ts", ".js"]);

/** 文件直接用；目录找 index.ts / index.js（pi：loader.ts:667、:699）。 */
export function resolveEntry(path: string): string {
  const full = resolve(path);
  if (!existsSync(full)) throw new LoadError(path, "不存在");
  if (statSync(full).isDirectory()) {
    const index = ["index.ts", "index.js"].map((name) => join(full, name)).find((p) => existsSync(p));
    if (!index) throw new LoadError(path, "目录里没有 index.ts 或 index.js");
    return index;
  }
  if (!EXTENSION_FILE.has(extname(full))) throw new LoadError(path, "只接受 .ts 或 .js 文件");
  return full;
}

/**
 * 在宿主进程里直接 import 扩展模块，取默认导出。
 * pi 用 jiti（loader.ts:498-510）以便同时支持 TS 和虚拟模块；这里靠 Node 自带的类型剥离。
 * 这一步就是全部的「隔离」：没有 Worker、没有 vm、没有子进程。
 */
export async function importFactory(path: string): Promise<ExtensionFactory> {
  const entry = resolveEntry(path);
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  } catch (error) {
    throw new LoadError(path, `模块求值失败：${messageOf(error)}`, { cause: error });
  }
  if (typeof mod.default !== "function") throw new LoadError(path, "默认导出不是工厂函数");
  return mod.default as ExtensionFactory;
}

/** 执行工厂：成功就提交，抛错就丢弃并把错误交给调用方（pi：loader.ts:545-564）。 */
export async function initializeExtension(path: string, factory: ExtensionFactory, bus: EventBus) {
  const session = createExtensionAPI(path, bus);
  try {
    await factory(session.api);
  } catch (error) {
    session.discard();
    throw new LoadError(path, `工厂函数抛错：${messageOf(error)}`, { cause: error });
  }
  return session.commit();
}

export interface LoadResult {
  extensions: readonly Extension[];
  flags: ReadonlyMap<string, FlagValue>;
  errors: readonly LoadError[];
}

/** 逐个加载。一个扩展失败不影响其他扩展；flag 默认值先到先得（pi：loader.ts:467）。 */
export async function loadExtensions(paths: readonly string[], bus: EventBus): Promise<LoadResult> {
  let result: LoadResult = { extensions: [], flags: new Map(), errors: [] };
  for (const path of paths) {
    try {
      const { extension, flags } = await initializeExtension(path, await importFactory(path), bus);
      result = {
        ...result,
        extensions: [...result.extensions, extension],
        flags: new Map([...flags, ...result.flags]),
      };
    } catch (error) {
      if (!(error instanceof LoadError)) throw error;
      result = { ...result, errors: [...result.errors, error] };
    }
  }
  return result;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
