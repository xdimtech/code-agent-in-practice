import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseArgs, renderFacts, renderQuestions, renderVerdicts } from "../src/main.ts";
import { filterRoutes } from "../src/filter.ts";
import { DIMENSIONS } from "../src/types.ts";

const MAIN_TS = resolve(fileURLToPath(import.meta.url), "../../src/main.ts");

function run(args: readonly string[]): { code: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_TS, ...args], {
		encoding: "utf8",
		env: { ...process.env, CODE_AGENTS_DIR: "" },
	});
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("parseArgs：命令、开关、回答分开收", () => {
	const options = parseArgs(["filter", "--models", "mixed", "--brief", "--json", "--host", "python"]);
	assert.equal(options.command, "filter");
	assert.equal(options.brief, true);
	assert.equal(options.json, true);
	assert.equal(options.online, false);
	assert.deepEqual(options.answers, { models: "mixed", host: "python" });
});

test("parseArgs：--sources 不算回答", () => {
	const options = parseArgs(["verify", "--sources", "/x", "--online"]);
	assert.equal(options.sources, "/x");
	assert.equal(options.online, true);
	assert.deepEqual(options.answers, {});
});

test("parseArgs：各种写错都报清楚", () => {
	assert.throws(() => parseArgs([]), /第一个参数要是/);
	assert.throws(() => parseArgs(["rank"]), /第一个参数要是/);
	assert.throws(() => parseArgs(["filter", "models"]), /看不懂的参数/);
	assert.throws(() => parseArgs(["filter", "--models"]), /--models 后面要跟一个值/);
	assert.throws(() => parseArgs(["filter", "--models", "--host"]), /后面要跟一个值/);
	assert.throws(() => parseArgs(["filter", "--models", "a", "--models", "b"]), /给了两次/);
	assert.throws(() => parseArgs(["facts", "--models", "claude"]), /facts 不接受问题的回答/);
});

test("renderFacts：表头一行 + 分隔一行 + 八个维度，后面跟出处", () => {
	const text = renderFacts();
	const tableLines = text.split("\n").filter((line) => line.startsWith("| "));
	assert.equal(tableLines.length, 2 + DIMENSIONS.length);
	assert.match(text, /出处：/);
	assert.match(text, /【文档】https:\/\/code\.claude\.com/);
});

test("renderQuestions：每个问题列出选项和它驱动的规则数", () => {
	const text = renderQuestions();
	assert.match(text, /--models {2}要接哪些模型？（\d+ 条规则）/);
	assert.match(text, / {4}mixed {2}/);
});

test("renderVerdicts：列出没回答的问题；--brief 不打印出处", () => {
	const answers = { models: "mixed" };
	const full = renderVerdicts(answers, filterRoutes(answers), false);
	const brief = renderVerdicts(answers, filterRoutes(answers), true);
	assert.match(full, /没回答：host /);
	assert.match(full, /✗ Claude Agent SDK：排除/);
	assert.match(full, /【文档】/);
	assert.doesNotMatch(brief, /【文档】|【代码事实】/);
	assert.match(brief, /留下 3 条。顺序是固定的，不是名次/);
});

test("renderVerdicts：四条都排除时给出提示", () => {
	const answers = { models: "mixed", approval: "yes", upstream: "yes" };
	assert.match(renderVerdicts(answers, filterRoutes(answers), true), /四条都被排除了/);
});

test("命令行 filter：正常输出，退出码 0", () => {
	const result = run(["filter", "--models", "mixed", "--approval", "yes", "--brief"]);
	assert.equal(result.code, 0, result.stderr);
	assert.match(result.stdout, /✓ fork codex：可选/);
	assert.match(result.stdout, /✗ 基于 pi：排除/);
});

test("命令行 filter --json：能被解析，结构是 answers + verdicts", () => {
	const result = run(["filter", "--loop", "yes", "--json"]);
	assert.equal(result.code, 0, result.stderr);
	const parsed = JSON.parse(result.stdout) as { answers: unknown; verdicts: { status: string }[] };
	assert.deepEqual(parsed.answers, { loop: "yes" });
	assert.equal(parsed.verdicts.length, 4);
});

test("命令行：值拼错时退出码 1，错误进 stderr", () => {
	const result = run(["filter", "--models", "gpt"]);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /--models 的值只能是/);
	assert.equal(result.stdout, "");
});

test("命令行 verify：不给源码目录时只核对本书仓库，跳过的不算失败", () => {
	const result = run(["verify"]);
	assert.equal(result.code, 0, result.stdout);
	assert.match(result.stdout, /失败 0/);
	assert.match(result.stdout, /跳过：没有 pi 的源码目录/);
});

test("命令行 --help", () => {
	const result = run(["--help"]);
	assert.equal(result.code, 0);
	assert.match(result.stdout, /用法：/);
});
