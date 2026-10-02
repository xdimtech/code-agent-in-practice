// 读 package.json 并校验。它来自你准备安装的第三方包——外部输入，一个字段都不能假设。
// 坏的顶层结构直接拒绝；坏的单个字段丢掉并记一条警告，因为 pi 遇到它们也是静默丢掉的
// （pi-manifest.ts:27-29 只接受字符串数组），把这件事说出来正是检查的意义。

export const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type PiManifest = Readonly<Partial<Record<ResourceType, readonly string[]>>>;

export interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly keywords: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundledDependencies: readonly string[];
  /** 没有 pi 字段时为 undefined；有但为空对象时是 {}——两者对 pi 的意义完全不同 */
  readonly pi?: PiManifest;
}

export interface ParsedPackage {
  readonly pkg: PackageJson;
  readonly warnings: readonly string[];
}

export class PackageJsonError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringMap(raw: unknown, field: string, warnings: string[]): Record<string, string> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    warnings.push(`${field} 不是对象，已忽略`);
    return {};
  }
  const entries = Object.entries(raw).filter(([key, value]) => {
    if (typeof value === "string") return true;
    warnings.push(`${field}.${key} 不是字符串，已忽略`);
    return false;
  });
  return Object.fromEntries(entries) as Record<string, string>;
}

function stringList(raw: unknown, field: string, warnings: string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return [...raw];
  warnings.push(`${field} 不是字符串数组，pi 会静默忽略它`);
  return undefined;
}

function parsePi(raw: unknown, warnings: string[]): PiManifest | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push("pi 字段不是对象，pi 会当作没有清单");
    return undefined;
  }
  const fields = RESOURCE_TYPES.flatMap((type) => {
    const list = stringList(raw[type], `pi.${type}`, warnings);
    return list ? [[type, list] as const] : [];
  });
  return Object.fromEntries(fields);
}

/** `bundledDependencies: true` 的意思是「全部 dependencies 都打进 tarball」 */
function parseBundled(raw: unknown, deps: Record<string, string>, warnings: string[]): string[] {
  if (raw === true) return Object.keys(deps);
  return stringList(raw, "bundledDependencies", warnings) ?? [];
}

export function parsePackageJson(text: string): ParsedPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new PackageJsonError(`package.json 不是合法 JSON：${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw new PackageJsonError("package.json 顶层需要是对象");
  if (typeof raw.name !== "string" || raw.name.trim() === "") throw new PackageJsonError("package.json 缺少 name");

  const warnings: string[] = [];
  const dependencies = stringMap(raw.dependencies, "dependencies", warnings);
  const pkg: PackageJson = {
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    keywords: stringList(raw.keywords, "keywords", warnings) ?? [],
    scripts: stringMap(raw.scripts, "scripts", warnings),
    dependencies,
    peerDependencies: stringMap(raw.peerDependencies, "peerDependencies", warnings),
    bundledDependencies: parseBundled(raw.bundledDependencies ?? raw.bundleDependencies, dependencies, warnings),
    pi: parsePi(raw.pi, warnings),
  };
  return { pkg, warnings };
}
