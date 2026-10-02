// 同一个包、同一个资源名出现在多处时，谁赢。
// 两层去重：包按身份去重（dedupePackages，package-manager.ts:1708-1730），资源名按五级优先级先到先得
// （resourcePrecedenceRank :188-192，名字冲突在 resource-loader.ts:970-994 与 skills.ts:417-436 处理）。

import { posix } from "node:path";

export type Scope = "user" | "project" | "temporary";

export interface ResourceOrigin {
  /** package：来自某个包；top-level：settings 里直接写的路径或自动发现的目录 */
  readonly origin: "package" | "top-level";
  readonly scope: Scope;
  /** local：settings 里显式写的；auto：从 .pi/ 之类的目录自动发现的 */
  readonly source: "local" | "auto";
}

/** 0 项目显式 · 1 项目自动 · 2 用户显式 · 3 用户自动 · 4 任何包。包永远排最后，不管它装在哪个作用域。 */
export function precedenceRank(o: ResourceOrigin): number {
  if (o.origin === "package") return 4;
  return (o.scope === "project" ? 0 : 2) + (o.source === "local" ? 0 : 1);
}

export interface NamedResource extends ResourceOrigin {
  readonly name: string;
  readonly path: string;
}

export interface Collision {
  readonly name: string;
  readonly winner: string;
  readonly loser: string;
}

export interface Resolution {
  readonly winners: readonly NamedResource[];
  readonly collisions: readonly Collision[];
}

/** 先按 rank 稳定排序，再按名字先到先得；输掉的不报错，只记一条 collision 诊断。 */
export function resolveNames(resources: readonly NamedResource[]): Resolution {
  const sorted = resources.map((r, i) => ({ r, i })).sort((a, b) => precedenceRank(a.r) - precedenceRank(b.r) || a.i - b.i);
  const winners = new Map<string, NamedResource>();
  const collisions: Collision[] = [];
  for (const { r } of sorted) {
    const existing = winners.get(r.name);
    if (existing) collisions.push({ name: r.name, winner: existing.path, loser: r.path });
    else winners.set(r.name, r);
  }
  return { winners: [...winners.values()], collisions };
}

/**
 * 包身份不含版本：npm 只看包名，git 只看 host/path（SSH 与 HTTPS 视为同一个），本地看解析后的绝对路径
 * （getPackageIdentity，:1687-1701）。所以项目写 foo@2、用户写 foo@1，是「同一个包」，项目那份赢。
 */
export function packageIdentity(source: string, baseDir: string): string {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
    return `npm:${at === -1 ? spec : spec.slice(0, at)}`;
  }
  if (/^(git:|https?:\/\/|ssh:\/\/)/.test(source)) {
    const git = source.replace(/^git:/, "").match(/^(?:[a-z]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:](.+?)(?:\.git)?(?:@[^/]*)?$/);
    if (git) return `git:${git[1]}/${git[2]}`;
  }
  return `local:${posix.resolve(baseDir, source)}`;
}

export interface ConfiguredPackage {
  readonly source: string;
  readonly scope: Scope;
  readonly autoload?: boolean;
}

/** 项目赢；项目那份写了 autoload: false 时，它只是一份差量，用户那份也保留，差量在前。 */
export function dedupePackages(packages: readonly ConfiguredPackage[], baseDirs: Readonly<Record<Scope, string>>): readonly ConfiguredPackage[] {
  const result: ConfiguredPackage[] = [];
  const seen = new Map<string, number>();
  for (const pkg of packages) {
    const id = packageIdentity(pkg.source, baseDirs[pkg.scope]);
    const index = seen.get(id);
    if (index === undefined) {
      seen.set(id, result.length);
      result.push(pkg);
      continue;
    }
    const existing = result[index];
    if (existing?.scope === "project" && pkg.scope === "user") {
      if (existing.autoload === false) result.push(pkg);
    } else if (pkg.scope === "project") {
      result.splice(index, 1, pkg);
    }
  }
  return result;
}
