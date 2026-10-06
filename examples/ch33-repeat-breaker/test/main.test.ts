import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { EXIT, parseArgs, UsageError } from "../src/main.ts";

const HERE = resolve(fileURLToPath(import.meta.url), "../..");
const MAIN_TS = join(HERE, "src/main.ts");
const fixture = (name: string) => join(HERE, "fixtures", name);
const root = mkdtempSync(join(tmpdir(), "repeat-breaker-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

function run(args: readonly string[]): { code: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_TS, ...args], { encoding: "utf8" });
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("parseArgs：默认配置、--kimi、--max-steps、--thresholds", () => {
	assert.deepEqual(parseArgs(["t.jsonl"]), { trajectory: "t.jsonl", config: DEFAULT_CONFIG, json: false });
	assert.equal(parseArgs(["t", "--kimi"]).config.cycle.enabled, false);
	assert.equal(parseArgs(["t", "--max-steps", "40"]).config.maxSteps, 40);
	assert.equal(parseArgs(["t", "--thresholds", "2,4,6,9"]).config.stopAt, 9);
});

test("parseArgs：用法错误", () => {
	assert.throws(() => parseArgs([]), /只给一份/);
	assert.throws(() => parseArgs(["a", "b"]), /只给一份/);
	assert.throws(() => parseArgs(["a", "--strict"]), /看不懂的参数/);
	assert.throws(() => parseArgs(["a", "--max-steps"]), /正整数/);
	assert.throws(() => parseArgs(["a", "--max-steps", "-1"]), /正整数/);
	assert.throws(() => parseArgs(["a", "--max-steps", "0"]), UsageError);
	assert.throws(() => parseArgs(["a", "--thresholds", "3,5,8"]), /四个整数/);
	assert.throws(() => parseArgs(["a", "--thresholds", "3,5,5,12"]), /严格递增/);
	assert.throws(() => parseArgs(["a", "--thresholds", "1,5,8,12"]), /不小于 2/);
});

test("CLI：loop-read 逐级提醒、第 12 步停、第 13 步交接，退出 1", () => {
	const { code, stdout } = run([fixture("loop-read.jsonl")]);
	assert.equal(code, EXIT.intervened);
	assert.match(stdout, /第 1 轮 第 3 步  Read  连续 3 次 → 提醒 1/);
	assert.match(stdout, /第 1 轮 第 12 步  Read  连续 12 次 → 停止，下一步只许写字\n  第 1 轮 第 13 步  交接  文字回复\n  第 1 轮结束：断路器（13 步）/);
});

test("CLI：正常会话退出 0", () => {
	const { code, stdout } = run([fixture("healthy.jsonl")]);
	assert.equal(code, EXIT.quiet);
	assert.match(stdout, /没有干预。$/m);
});

test("CLI：--kimi 下交替不干预，默认干预", () => {
	assert.equal(run([fixture("abab.jsonl"), "--kimi"]).code, EXIT.quiet);
	assert.equal(run([fixture("abab.jsonl")]).code, EXIT.intervened);
});

test("CLI：--json 输出能解析", () => {
	const { code, stdout } = run([fixture("same-step.jsonl"), "--json"]);
	assert.equal(code, EXIT.intervened);
	assert.equal(JSON.parse(stdout).summary.shared, 2);
});

test("CLI：读不了、坏轨迹、坏参数都退出 2", () => {
	const broken = join(root, "broken.jsonl");
	writeFileSync(broken, '{"calls":[]}\nnot json\n');
	assert.equal(run([join(root, "nope.jsonl")]).code, EXIT.usage);
	const bad = run([broken]);
	assert.equal(bad.code, EXIT.usage);
	assert.match(bad.stderr, /第 2 行/);
	assert.equal(run([fixture("healthy.jsonl"), "--thresholds", "5,3,8,12"]).code, EXIT.usage);
});
