// 用法：
//   npm start                                   # 审计本书仓库自己（演示用）
//   npm start -- <仓库>                         # 按内置的 pi 清单审计一个仓库
//   npm start -- <上游> <fork>                  # 两个仓库逐项对照状态
//   npm start -- --manifest my.json <仓库>      # 换成自己的清单（JSON，格式见 src/manifest.ts）

import { readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./classify.ts";
import { ManifestError, parseManifest, type Capability } from "./manifest.ts";
import { PI_MANIFEST } from "./pi-manifest.ts";
import { grepIn, repoRoot, RepoError } from "./probe.ts";
import { renderCompare, renderSingle } from "./report.ts";

class UsageError extends Error {}

const USAGE = "用法：npm start -- [--manifest 清单.json] <仓库> [fork]";

function loadManifest(path: string): Capability[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ManifestError(`读不到清单文件：${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(`清单不是合法 JSON：${path}（${(error as Error).message}）`);
  }
  return parseManifest(raw);
}

function parseArgs(argv: readonly string[]): { manifest: readonly Capability[]; repos: readonly string[] } {
  const i = argv.indexOf("--manifest");
  const file = i === -1 ? undefined : argv[i + 1];
  if (i !== -1 && file === undefined) throw new UsageError(`--manifest 后面要跟文件路径。${USAGE}`);
  const given = argv.filter((_, j) => i === -1 || (j !== i && j !== i + 1));
  if (given.length > 2) throw new UsageError(USAGE);
  const repos = given.length === 0 ? ["."] : given;
  return { manifest: file ? loadManifest(file) : PI_MANIFEST, repos };
}

/** 本工具所在目录，相对于被审计仓库的根；不在该仓库里时为空 */
function selfIn(root: string): string[] {
  const self = relative(root, resolve(fileURLToPath(import.meta.url), "../.."));
  return self === "" || self.startsWith("..") || isAbsolute(self) ? [] : [self];
}

function auditRepo(dir: string, manifest: readonly Capability[]) {
  const root = repoRoot(dir);
  return { title: basename(root), rows: audit(manifest, grepIn(root, selfIn(root))) };
}

function main(argv: readonly string[]): void {
  const { manifest, repos } = parseArgs(argv);
  const [a, b] = repos.map((r) => auditRepo(r, manifest));
  console.log(b ? renderCompare(a!, b) : renderSingle(a!.title, a!.rows));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError || error instanceof RepoError || error instanceof ManifestError)) throw error;
  console.error(error.message);
  process.exit(2);
}
