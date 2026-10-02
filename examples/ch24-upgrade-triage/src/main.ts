import { dirname, join } from "node:path";
import { between, parseChangelog } from "./changelog.ts";
import { demo } from "./demo.ts";
import { parseLedger } from "./ledger.ts";
import { buildManifest, InputError, pathExists, readText } from "./manifest.ts";
import { reconcile } from "./reconcile.ts";
import { printFates, printFiles, printFindings, printLedger, printReleases, printTally, section } from "./report.ts";
import { compareVersions, VersionError } from "./semver.ts";
import { detectMoves, type Move, needsHuman, relocate, relocatePrefix, tally, triage } from "./triage.ts";
import type { Finding } from "./types.ts";
import { ageInDays, checkVendorMarker } from "./vendor.ts";

const USAGE = `用法：
  npm start                                                  演示
  npm start -- changelog <CHANGELOG.md> [--from 版本] [--to 版本]
  npm start -- ledger <台账.md>
  npm start -- vendor <标记.json>
  npm start -- triage --base <目录> --ours <目录> --next <目录> [--ledger <台账.md>] [--ext .ts,.tsx] [--map 上游前缀=我们的前缀]… [--follow-moves]`;

const VALUE_OPTIONS = ["--from", "--to", "--base", "--ours", "--next", "--ledger", "--ext", "--map"];

/** 取 --name 后面的所有值；给了选项却没有值就报错 */
function options(args: readonly string[], name: string): string[] {
  return args.flatMap((a, i) => {
    if (a !== name) return [];
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new InputError(`${name} 后面要跟一个值`);
    return [value];
  });
}

const option = (args: readonly string[], name: string): string | undefined => options(args, name)[0];

function required(args: readonly string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new InputError(`缺 ${name}\n${USAGE}`);
  return value;
}

function positional(args: readonly string[]): string {
  const file = args.find((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.includes(args[i - 1] ?? ""));
  if (!file) throw new InputError(USAGE);
  return file;
}

const failed = (findings: readonly Finding[]): number => (findings.some((f) => f.severity === "error") ? 1 : 0);

function changelog(args: readonly string[]): number {
  const parsed = parseChangelog(readText(positional(args)));
  if (parsed.releases.length === 0) throw new InputError("没找到任何「## [版本]」形式的标题");
  const newest = parsed.releases.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  const from = option(args, "--from") ?? "0.0.0";
  const to = option(args, "--to") ?? newest.version;
  const range = between(parsed.releases, from, to);
  console.log(`  区间 (${from}, ${to}]`);
  printReleases(range);
  const headings = [...parsed.breakingHeadings].map(([heading, n]) => `「${heading}」${n} 次`);
  if (headings.length > 1) console.log(`  破坏性变更小节的标题有 ${headings.length} 种写法：${headings.join("，")}`);
  if (parsed.skipped.length > 0) console.log(`  版本号认不出来、跳过的：${parsed.skipped.join("，")}`);
  return range.some((r) => r.breaking.length > 0) ? 1 : 0;
}

function ledger(args: readonly string[]): number {
  const parsed = parseLedger(readText(positional(args)));
  printLedger(parsed.entries);
  printFindings(parsed.findings);
  return failed(parsed.findings);
}

function vendor(args: readonly string[]): number {
  const file = positional(args);
  const { marker, findings } = checkVendorMarker(readText(file), (relative) => pathExists(join(dirname(file), relative)));
  if (marker) {
    const age = ageInDays(marker.importedAt, new Date());
    console.log(`  ${marker.name || "（没写名字）"} @ ${marker.commit.slice(0, 8) || "?"}${marker.ref ? `（${marker.ref}）` : ""}，${marker.importedAt || "?"} 导入${age === undefined ? "" : `，距今 ${age} 天`}`);
  }
  printFindings(findings);
  return failed(findings);
}

function parseMap(text: string): Move {
  const [from, to, ...rest] = text.split("=");
  if (!from || !to || rest.length > 0) throw new InputError(`--map 的格式是「上游前缀=我们的前缀」，现在是「${text}」`);
  return { from, to };
}

function triageDirs(args: readonly string[]): number {
  const extensions = option(args, "--ext")?.split(",").map((e) => e.trim()).filter(Boolean);
  const load = (name: string) => buildManifest(required(args, name), extensions ? { extensions } : {});
  const [base, next] = [load("--base"), load("--next")];
  const renamed = relocatePrefix(load("--ours"), options(args, "--map").map(parseMap));
  const moves = args.includes("--follow-moves") ? detectMoves(base, renamed) : [];
  if (moves.length > 0) console.log(`  原样挪走、已挪回去比对的文件：${moves.length} 个`);
  const files = triage(base, relocate(renamed, moves), next);
  printTally(tally(files), files.length);
  printFiles(needsHuman(files));
  const ledgerFile = option(args, "--ledger");
  if (!ledgerFile) return needsHuman(files).length > 0 ? 1 : 0;
  section("对账");
  const parsed = parseLedger(readText(ledgerFile));
  const { fates, findings } = reconcile(parsed.entries, files);
  printFates(fates);
  printFindings(findings);
  return needsHuman(files).length > 0 || failed(findings) ? 1 : 0;
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => number>> = { changelog, ledger, vendor, triage: triageDirs };

function main(args: readonly string[]): number {
  if (args.length === 0) {
    demo();
    return 0;
  }
  const command = COMMANDS[args[0]];
  if (!command) throw new InputError(USAGE);
  return command(args.slice(1));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof InputError || error instanceof VersionError) {
    console.error(`错误：${error.message}`);
    process.exit(2);
  }
  throw error;
}
