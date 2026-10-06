import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { EXIT, loadConfig, parseArgs, UsageError } from "../src/main.ts";

const HERE = resolve(fileURLToPath(import.meta.url), "../..");
const MAIN_TS = join(HERE, "src/main.ts");
const fixture = (name: string) => join(HERE, "fixtures", name);
const root = mkdtempSync(join(tmpdir(), "runaway-guard-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

function run(args: readonly string[]): { code: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_TS, ...args], { encoding: "utf8" });
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("parseArgs：选项与一份轨迹", () => {
	assert.deepEqual(parseArgs(["t.jsonl", "--local", "l.json", "--shadow"]), { trajectory: "t.jsonl", local: "l.json", shadow: true, json: false });
	assert.throws(() => parseArgs([]), UsageError);
	assert.throws(() => parseArgs(["a", "b"]), /只给一份/);
	assert.throws(() => parseArgs(["a", "--remote"]), /后面要跟/);
	assert.throws(() => parseArgs(["a", "--strict"]), /看不懂的参数/);
});

test("loadConfig：本地读不了是用法错误，远端读不了只是没覆盖", () => {
	assert.throws(() => loadConfig({ trajectory: "t", local: join(root, "nope.json"), shadow: false, json: false }), UsageError);
	const broken = join(root, "broken.json");
	writeFileSync(broken, "{ not json");
	assert.equal(loadConfig({ trajectory: "t", remote: broken, shadow: false, json: false }).enabled, true);
});

test("CLI：有提醒退出 1，按步数先后列出", () => {
	const { code, stdout } = run([fixture("mixed.jsonl")]);
	assert.equal(code, EXIT.triggered);
	assert.match(stdout, /观测  第 2 步  result_repeat\n  提醒  第 3 步  action_repeat\n  观测  第 5 步/);
});

test("CLI：没有提醒退出 0", () => {
	const { code, stdout } = run([fixture("abab.jsonl")]);
	assert.equal(code, EXIT.quiet);
	assert.match(stdout, /没有提醒。/);
});

test("CLI：--shadow 和远端关闭都退出 0", () => {
	assert.equal(run([fixture("loop-read.jsonl"), "--shadow"]).code, EXIT.quiet);
	assert.equal(run([fixture("loop-read.jsonl"), "--remote", fixture("remote-off.json")]).code, EXIT.quiet);
});

test("CLI：本地阈值 4，提醒推迟到第 4 步", () => {
	assert.match(run([fixture("loop-read.jsonl"), "--local", fixture("local.json")]).stdout, /提醒  第 4 步/);
});

test("CLI：远端坏了一个字段，另一个字段（maxSteps 5）照样生效", () => {
	const { code, stdout } = run([fixture("loop-read.jsonl"), "--remote", fixture("remote-bad.json")]);
	assert.equal(code, EXIT.triggered);
	assert.match(stdout, /阈值 3，硬上限 5/);
	assert.match(stdout, /停止  第 5 步/);
});

test("CLI：--json 输出可解析，且不含参数原文", () => {
	const { stdout } = run([fixture("loop-read.jsonl"), "--json"]);
	const report = JSON.parse(stdout);
	assert.equal(report.summary.reminderInjected, true);
	assert.ok(!stdout.includes("src/app.ts"));
});

test("CLI：坏轨迹、读不了的本地配置，退出 2 并说清楚", () => {
	const bad = join(root, "bad.jsonl");
	writeFileSync(bad, '{"calls":[],"results":[]}\n{"calls":[{"id":"a","tool":"read"}],"results":[]}\n');
	const broken = run([bad]);
	assert.equal(broken.code, EXIT.usage);
	assert.match(broken.stderr, /第 2 行/);
	assert.equal(run([fixture("loop-read.jsonl"), "--local", join(root, "nope.json")]).code, EXIT.usage);
	assert.equal(run([join(root, "missing.jsonl")]).code, EXIT.usage);
	assert.equal(run([]).code, EXIT.usage);
});
