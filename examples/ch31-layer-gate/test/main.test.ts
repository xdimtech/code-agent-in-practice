import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { EXIT, parseArgs, renderReport, scopeProblem } from "../src/main.ts";
import { SELF_TEST_CONFIG } from "../src/self-test.ts";

const MAIN_TS = resolve(fileURLToPath(import.meta.url), "../../src/main.ts");
const root = mkdtempSync(join(tmpdir(), "layer-gate-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): string {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
	return full;
}

function run(args: readonly string[]): { code: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_TS, ...args], { encoding: "utf8" });
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const configPath = write("gate.json", JSON.stringify(SELF_TEST_CONFIG));
const clean = join(root, "clean");
const dirty = join(root, "dirty");
for (const repo of [clean, dirty]) {
	for (const dir of ["packages/contracts/src", "packages/core/src", "packages/ui/src", "apps/cli/src/ui"]) mkdirSync(join(repo, dir), { recursive: true });
}
write("clean/packages/core/src/a.ts", 'import "@demo/contracts";\n');
write("dirty/packages/core/src/a.ts", 'import "@demo/contracts";\nimport "@demo/cli";\n');

test("parseArgs：两种模式", () => {
	assert.deepEqual(parseArgs(["--self-test"]), { mode: "self-test" });
	assert.deepEqual(parseArgs(["--config", "c.json", "--json", "repo"]), { mode: "scan", config: "c.json", root: "repo", json: true });
});

test("parseArgs：各种写错都报清楚", () => {
	assert.throws(() => parseArgs([]), /--config/);
	assert.throws(() => parseArgs(["--config"]), /后面要跟/);
	assert.throws(() => parseArgs(["--config", "c.json"]), /一个仓库根目录/);
	assert.throws(() => parseArgs(["--config", "c.json", "a", "b"]), /一个仓库根目录/);
	assert.throws(() => parseArgs(["--strict", "--config", "c.json", "a"]), /看不懂的参数/);
	assert.throws(() => parseArgs(["--self-test", "repo"]), /看不懂的参数/);
});

test("scopeProblem：没扫到文件或目录缺失，都不算「通过」", () => {
	const base = { files: 3, imports: 5, findings: [], missingPaths: [] };
	assert.equal(scopeProblem(base), undefined);
	assert.match(scopeProblem({ ...base, files: 0 })!, /一个源文件都没扫到/);
	assert.match(scopeProblem({ ...base, missingPaths: ["x/"] })!, /x\//);
});

test("renderReport：先报扫了多少，再报违规", () => {
	const text = renderReport({ files: 2, imports: 3, findings: [], missingPaths: [] });
	assert.match(text, /扫了 2 个文件、3 条 import\n没有违规。/);
});

test("CLI：干净的仓库退出 0", () => {
	const result = run(["--config", configPath, clean]);
	assert.equal(result.code, EXIT.ok, result.stderr);
	assert.match(result.stdout, /扫了 1 个文件、1 条 import/);
});

test("CLI：有违规退出 1，--json 可解析", () => {
	const result = run(["--config", configPath, "--json", dirty]);
	assert.equal(result.code, EXIT.violations);
	const report = JSON.parse(result.stdout);
	assert.equal(report.findings.length, 1);
	assert.equal(report.findings[0].line, 2);
});

test("CLI：配置坏了、目录不存在、什么都没扫到，都退出 2", () => {
	const bad = write("bad.json", JSON.stringify({ layers: [{ name: "a", paths: ["a/"], mayImport: ["a"] }] }));
	const broken = write("broken.json", "{");
	const empty = join(root, "empty");
	mkdirSync(empty);
	for (const [args, pattern] of [
		[["--config", bad, clean], /不用写自己/],
		[["--config", broken, clean], /读不了配置/],
		[["--config", join(root, "nope.json"), clean], /读不了配置/],
		[["--config", configPath, empty], /目录不存在/],
		[["--config", configPath, join(root, "clean-but-empty")], /目录不存在/],
		[["--nope"], /看不懂的参数/],
	] as const) {
		const result = run(args);
		assert.equal(result.code, EXIT.usage, `${args.join(" ")}\n${result.stdout}`);
		assert.match(result.stderr, pattern);
	}
});

test("CLI：目录都在、却没有一个源文件，也退出 2", () => {
	const hollow = join(root, "hollow");
	for (const dir of ["packages/contracts/src", "packages/core/src", "packages/ui/src", "apps/cli/src/ui"]) mkdirSync(join(hollow, dir), { recursive: true });
	const result = run(["--config", configPath, hollow]);
	assert.equal(result.code, EXIT.usage);
	assert.match(result.stderr, /一个源文件都没扫到/);
});
