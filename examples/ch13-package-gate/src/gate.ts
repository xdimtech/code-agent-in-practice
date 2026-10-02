// 安装闸门：pi 给第三方包拼的 install 参数里没有 --ignore-scripts（package-manager.ts:1785-1806），
// 而它给自己装依赖时一律带上，并用一份白名单审 lockfile 里每一个有安装脚本的包
// （package-manager-cli.ts:88-98、scripts/generate-coding-agent-shrinkwrap.mjs:13-16、:241-261）。
// 这个模块把后一套纪律搬到前一个场景：先不跑脚本装上，审过 lockfile，再只为白名单里的包补跑。

import { basename } from "node:path";

export type PackageManagerName = "npm" | "pnpm" | "bun" | (string & {});

export class LockfileError extends Error {}

/** npmCommand 可以是 ["mise","exec","node@20","--","npm"]；取最后一个 -- 之后的那个命令名（:1759-1765）。 */
export function packageManagerName(npmCommand: readonly string[] | undefined): PackageManagerName {
  const parts = npmCommand && npmCommand.length > 0 ? npmCommand : ["npm"];
  const sep = parts.lastIndexOf("--");
  const command = sep >= 0 ? parts[sep + 1] : parts[0];
  return command ? basename(command).replace(/\.(cmd|exe)$/i, "") : "";
}

/** 与 pi 逐项相同：三个分支都只关 peer 解析，没有一个关安装脚本。 */
export function piInstallArgs(pm: PackageManagerName, specs: readonly string[], root: string): readonly string[] {
  if (pm === "bun") return ["install", ...specs, "--cwd", root, "--omit=peer"];
  if (pm === "pnpm") {
    return [
      "install", ...specs, "--prefix", root,
      "--config.auto-install-peers=false", "--config.strict-peer-dependencies=false", "--config.strict-dep-builds=false",
    ];
  }
  return ["install", ...specs, "--prefix", root, "--legacy-peer-deps"];
}

/** 闸门版：在 pi 的参数后面补 --ignore-scripts。三个包管理器都认这个参数。 */
export function gatedInstallArgs(pm: PackageManagerName, specs: readonly string[], root: string): readonly string[] {
  return [...piInstallArgs(pm, specs, root), "--ignore-scripts"];
}

/** git 来源是在克隆目录里跑 install：此时包自己就是根项目，它的 preinstall/postinstall/prepare 都会跑（:1854-1856、:1772-1778）。 */
export function gitInstallArgs(hasCustomNpmCommand: boolean, gated: boolean): readonly string[] {
  const base = hasCustomNpmCommand ? ["install"] : ["install", "--omit=dev"];
  return gated ? [...base, "--ignore-scripts"] : base;
}

export interface LockEntry {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly hasInstallScript: boolean;
}

/** "node_modules/@scope/a/node_modules/b" → "b"；根条目 "" 没有包名。 */
export function nameFromLockPath(path: string): string | undefined {
  const marker = "node_modules/";
  const at = path.lastIndexOf(marker);
  return at === -1 ? undefined : path.slice(at + marker.length);
}

/** 只认 lockfileVersion ≥ 2 的 packages 表；lockfile 也是外部输入，结构不对就拒绝，不猜。 */
export function parseLockfile(text: string): readonly LockEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new LockfileError(`lockfile 不是合法 JSON：${(error as Error).message}`);
  }
  const lock = raw as { lockfileVersion?: unknown; packages?: unknown };
  if (typeof lock !== "object" || lock === null || typeof lock.lockfileVersion !== "number" || lock.lockfileVersion < 2) {
    throw new LockfileError("只支持 lockfileVersion ≥ 2 的 package-lock.json");
  }
  if (typeof lock.packages !== "object" || lock.packages === null) throw new LockfileError("lockfile 缺少 packages 表");
  return Object.entries(lock.packages as Record<string, unknown>).flatMap(([path, value]) => {
    const name = nameFromLockPath(path);
    const entry = value as { version?: unknown; hasInstallScript?: unknown } | null;
    if (!name || typeof entry !== "object" || entry === null) return [];
    return [{ path, name, version: typeof entry.version === "string" ? entry.version : "", hasInstallScript: entry.hasInstallScript === true }];
  });
}

export interface ScriptReview {
  /** 有安装脚本、且 name@version 在白名单里 */
  readonly allowed: readonly string[];
  /** 有安装脚本、不在白名单里：要人去看 */
  readonly blocked: readonly string[];
  /** 白名单里有、lockfile 里已经没有：删掉它，免得白名单只增不减 */
  readonly stale: readonly string[];
}

/** 白名单的键是 name@version 而不是 name：升级一个版本就要重新审一次，与 pi 自己的规则相同。 */
export function reviewInstallScripts(entries: readonly LockEntry[], allowlist: ReadonlyMap<string, string>): ScriptReview {
  const ids = [...new Set(entries.filter((e) => e.hasInstallScript).map((e) => `${e.name}@${e.version}`))].sort();
  return {
    allowed: ids.filter((id) => allowlist.has(id)),
    blocked: ids.filter((id) => !allowlist.has(id)),
    stale: [...allowlist.keys()].filter((id) => !ids.includes(id)).sort(),
  };
}

/** 审过之后，只为白名单里的包补跑安装脚本。 */
export function rebuildArgs(allowed: readonly string[], root: string): readonly string[] {
  const names = allowed.map((id) => id.slice(0, id.lastIndexOf("@")));
  return names.length === 0 ? [] : ["rebuild", ...names, "--prefix", root];
}
