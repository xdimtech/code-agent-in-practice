import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gatedInstallArgs, parseLockfile, piInstallArgs, rebuildArgs, reviewInstallScripts, LockfileError } from "./gate.ts";
import { hasBlocking, inspectPackage, type Finding, type SourceKind } from "./inspect.ts";
import { loadPackageDir, PackageDirError, readText } from "./load.ts";
import { PackageJsonError, RESOURCE_TYPES } from "./package-json.ts";
import { applyPatterns } from "./patterns.ts";
import { dedupePackages, resolveNames, type NamedResource } from "./precedence.ts";
import { collectPackageResources, enabledPaths, type PackageFilter, type Resources } from "./resources.ts";

const DEMO = join(dirname(fileURLToPath(import.meta.url)), "..", "demo");
const INSTALL_ROOT = "~/.pi/agent/npm";

const section = (title: string) => console.log(`\n== ${title} ==`);
const counts = (r: Resources) => RESOURCE_TYPES.map((t) => `${t} ${enabledPaths(r, t).length}`).join(" · ");
const printFindings = (findings: readonly Finding[]) => {
  for (const f of findings) console.log(`  [${f.severity}] ${f.message}`);
};

function inspectDir(dir: string, source: SourceKind) {
  const { parsed, tree } = loadPackageDir(dir);
  const collected = collectPackageResources(tree, parsed.pkg.pi);
  return { parsed, tree, collected, findings: inspectPackage(parsed, tree, collected, source) };
}

function demo(): void {
  section("1. 清单与约定目录：有清单就只看清单");
  const review = inspectDir(join(DEMO, "review-pack"), "npm");
  console.log(`  review-pack 走 ${review.collected.mode}：${counts(review.collected.resources)}`);
  for (const t of RESOURCE_TYPES) for (const p of enabledPaths(review.collected.resources, t)) console.log(`    ${t.padEnd(10)} ${p}`);
  printFindings(review.findings);

  section("2. 给包加一个过滤器，加载的资源反而变多");
  const filter: PackageFilter = { extensions: ["!extensions/legacy.ts"] };
  const filtered = collectPackageResources(review.tree, review.parsed.pkg.pi, filter);
  console.log(`  过滤器 ${JSON.stringify(filter)}`);
  console.log(`  之前：${counts(review.collected.resources)}`);
  console.log(`  之后：${counts(filtered.resources)}`);
  console.log(`  多出来的主题：${enabledPaths(filtered.resources, "themes").join(", ")}`);

  section("3. 过滤四步与两层去重");
  const all = ["themes/a.json", "themes/b.json", "themes/legacy.json"];
  const kept = applyPatterns(all, ["!themes/*.json", "+themes/legacy.json", "+themes/a.json", "-themes/a.json"]);
  console.log(`  ! 全排除 → + 救回 legacy 和 a → - 再删 a：${[...kept].join(", ")}`);
  const skills: readonly NamedResource[] = [
    { name: "code-review", path: "review-pack/skills/code-review/SKILL.md", origin: "package", scope: "project", source: "local" },
    { name: "code-review", path: "~/.pi/agent/skills/code-review/SKILL.md", origin: "top-level", scope: "user", source: "auto" },
    { name: "deploy", path: ".pi/skills/deploy/SKILL.md", origin: "top-level", scope: "project", source: "auto" },
  ];
  const resolved = resolveNames(skills);
  console.log(`  同名技能：${resolved.winners.map((w) => w.path).join(" | ")}`);
  for (const c of resolved.collisions) console.log(`  collision ${c.name}：${c.loser} 输给 ${c.winner}`);
  const packages = dedupePackages(
    [{ source: "npm:review-pack@1.1.0", scope: "user" }, { source: "npm:review-pack@1.2.0", scope: "project" }],
    { user: "/home/me/.pi/agent", project: "/work/shop/.pi", temporary: "/tmp" },
  );
  console.log(`  包去重（身份不含版本）：${packages.map((p) => `${p.source}(${p.scope})`).join(", ")}`);

  section("4. 装之前先检查：sneaky-pack");
  for (const source of ["npm", "git"] as const) {
    const sneaky = inspectDir(join(DEMO, "sneaky-pack"), source);
    console.log(`  -- 作为 ${source} 来源（${sneaky.collected.mode}：${counts(sneaky.collected.resources)}）`);
    printFindings(sneaky.findings);
  }

  section("5. 安装闸门：先不跑脚本，审过 lockfile，再只补跑白名单");
  console.log(`  pi 的参数：npm ${piInstallArgs("npm", ["sneaky-pack"], INSTALL_ROOT).join(" ")}`);
  console.log(`  闸门参数：npm ${gatedInstallArgs("npm", ["sneaky-pack"], INSTALL_ROOT).join(" ")}`);
  const entries = parseLockfile(readText(join(DEMO, "package-lock.json")));
  const allowlist = new Map(Object.entries(JSON.parse(readText(join(DEMO, "allowlist.json"))) as Record<string, string>));
  const verdict = reviewInstallScripts(entries, allowlist);
  console.log(`  有安装脚本的包：${entries.filter((e) => e.hasInstallScript).length} 个`);
  console.log(`  放行：${verdict.allowed.join(", ") || "无"}`);
  console.log(`  拦下：${verdict.blocked.join(", ") || "无"}`);
  console.log(`  白名单过期：${verdict.stale.join(", ") || "无"}`);
  console.log(`  补跑：npm ${rebuildArgs(verdict.allowed, INSTALL_ROOT).join(" ")}`);
}

function inspectCli(args: readonly string[]): number {
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new PackageDirError("用法：npm start -- <包目录> [--git|--local]");
  const source: SourceKind = args.includes("--git") ? "git" : args.includes("--local") ? "local" : "npm";
  const { parsed, collected, findings } = inspectDir(dir, source);
  console.log(`${parsed.pkg.name}@${parsed.pkg.version}（按 ${source} 来源检查，${collected.mode}：${counts(collected.resources)}）`);
  printFindings(findings);
  if (findings.length === 0) console.log("  没有发现问题");
  return hasBlocking(findings) ? 1 : 0;
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0) demo();
  else process.exitCode = inspectCli(args);
} catch (error) {
  if (error instanceof PackageJsonError || error instanceof PackageDirError || error instanceof LockfileError) {
    console.error(`错误：${error.message}`);
    process.exit(2);
  }
  throw error;
}
