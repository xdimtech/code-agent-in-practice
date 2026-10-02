// 一个包最终贡献哪些资源：清单、约定目录、settings 过滤器三条路（collectPackageResources，package-manager.ts:2153-2202）。
// 三条路的发现规则并不一致——这正是本模块要演示的：给包加一个过滤器，加载的资源可能反而变多。

import { RESOURCE_TYPES, type PiManifest, type ResourceType } from "./package-json.ts";
import { applyPatterns, hasGlob, isOverridePattern, matchesAnyExactPattern, matchesAnyPattern } from "./patterns.ts";
import { collectFromPath, collectResourceFiles, expandGlob, type FileTree } from "./tree.ts";

/** settings.json 里 packages 的对象写法（PackageFilter，:194-200） */
export interface PackageFilter extends Readonly<Partial<Record<ResourceType, readonly string[]>>> {
  readonly autoload?: boolean;
}

export interface Resource {
  readonly path: string;
  readonly enabled: boolean;
}

export type Resources = Readonly<Record<ResourceType, readonly Resource[]>>;

export interface Collected {
  /** filter：按 settings 过滤；manifest：只看清单；convention：只看约定目录 */
  readonly mode: "filter" | "manifest" | "convention";
  readonly resources: Resources;
  /** 清单里写了、但一个文件也没解析出来的条目——pi 会静默跳过它们 */
  readonly unmatched: readonly string[];
}

function manifestFiles(tree: FileTree, entries: readonly string[], type: ResourceType): readonly string[] {
  const sources = entries.filter((e) => !isOverridePattern(e));
  const paths = sources.flatMap((e) => (hasGlob(e) ? expandGlob(tree, e) : [e]));
  const files = paths.flatMap((p) => collectFromPath(tree, p, type));
  const enabled = applyPatterns(files, entries.filter(isOverridePattern));
  return [...new Set(files.filter((f) => enabled.has(f)))];
}

function unmatchedEntries(tree: FileTree, manifest: PiManifest): string[] {
  return RESOURCE_TYPES.flatMap((type) =>
    (manifest[type] ?? [])
      .filter((e) => !isOverridePattern(e))
      .filter((e) => manifestFiles(tree, [e], type).length === 0)
      .map((e) => `pi.${type}: ${e}`),
  );
}

const allEnabled = (paths: readonly string[]): Resource[] => paths.map((path) => ({ path, enabled: true }));

/** 有过滤器时，类型没写就退回默认：清单有这一类就用清单，否则看约定目录（collectDefaultResources，:2204）。 */
function defaultFiles(tree: FileTree, manifest: PiManifest | undefined, type: ResourceType): readonly string[] {
  const entries = manifest?.[type];
  return entries ? manifestFiles(tree, entries, type) : collectResourceFiles(tree, type, type);
}

/** 过滤器的候选全集：清单这一类非空就用清单，空数组或没写都退回约定目录（collectManifestFiles，:2275-2296）。 */
function candidateFiles(tree: FileTree, manifest: PiManifest | undefined, type: ResourceType): readonly string[] {
  const entries = manifest?.[type];
  return entries && entries.length > 0 ? manifestFiles(tree, entries, type) : collectResourceFiles(tree, type, type);
}

/** autoload: false 时，过滤器是一份「差量」：只给提到的文件定状态，其余留给用户作用域那一份（:787-803、:2252-2268）。 */
function deltaResources(all: readonly string[], patterns: readonly string[]): Resource[] {
  const states = new Map<string, boolean>();
  for (const pattern of patterns) {
    const target = isOverridePattern(pattern) ? pattern.slice(1) : pattern;
    const enabled = !pattern.startsWith("-") && !pattern.startsWith("!");
    const exact = pattern.startsWith("+") || pattern.startsWith("-");
    const hits = all.filter((p) => (exact ? matchesAnyExactPattern(p, [target]) : matchesAnyPattern(p, [target])));
    for (const hit of hits) states.set(hit, enabled);
  }
  return [...states].map(([path, enabled]) => ({ path, enabled }));
}

function filteredResources(tree: FileTree, manifest: PiManifest | undefined, filter: PackageFilter, type: ResourceType): Resource[] {
  const patterns = filter[type];
  if (filter.autoload === false) return deltaResources(candidateFiles(tree, manifest, type), patterns ?? []);
  if (patterns === undefined) return allEnabled(defaultFiles(tree, manifest, type));
  const all = candidateFiles(tree, manifest, type);
  // 空数组表示「这一类全部关掉」，但文件仍然登记在案，状态是 disabled（:2236-2241）
  const enabled = patterns.length === 0 ? new Set<string>() : applyPatterns(all, patterns);
  return all.map((path) => ({ path, enabled: enabled.has(path) }));
}

function byType(make: (type: ResourceType) => readonly Resource[]): Resources {
  return Object.fromEntries(RESOURCE_TYPES.map((type) => [type, make(type)])) as Resources;
}

export function collectPackageResources(tree: FileTree, manifest: PiManifest | undefined, filter?: PackageFilter): Collected {
  const unmatched = manifest ? unmatchedEntries(tree, manifest) : [];
  if (filter) return { mode: "filter", resources: byType((t) => filteredResources(tree, manifest, filter, t)), unmatched };
  // 有清单就只看清单：清单没写的类型一个也不加载，约定目录被整体忽略（:2174-2186）
  if (manifest) return { mode: "manifest", resources: byType((t) => allEnabled(manifestFiles(tree, manifest[t] ?? [], t))), unmatched };
  return { mode: "convention", resources: byType((t) => allEnabled(collectResourceFiles(tree, t, t))), unmatched };
}

export const enabledPaths = (resources: Resources, type: ResourceType): readonly string[] =>
  resources[type].filter((r) => r.enabled).map((r) => r.path);
