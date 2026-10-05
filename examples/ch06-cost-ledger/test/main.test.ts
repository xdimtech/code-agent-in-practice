import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildDemoSession } from "../src/demo.ts";
import { compaction, effort, EXIT, ledger, numberFlag, truncation, UsageError } from "../src/main.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN, ...args], { encoding: "utf8" });

test("numberFlag：没给用默认，给了必须是非负整数", () => {
	assert.equal(numberFlag([], "--n", 7), 7);
	assert.equal(numberFlag(["--n", "3"], "--n", 7), 3);
	assert.throws(() => numberFlag(["--n"], "--n", 7), UsageError);
	assert.throws(() => numberFlag(["--n", "-1"], "--n", 7), UsageError);
	assert.throws(() => numberFlag(["--n", "1.5"], "--n", 7), UsageError);
});

test("ledger：演示会话出三段账，退出码 0", () => {
	const { out, code } = ledger(buildDemoSession());
	assert.equal(code, EXIT.ok);
	assert.match(out, /会话实际花费 \$1\.27/);
	assert.match(out, /a06 .*空闲超过 5 分钟  ← pi 会在对话里提示/);
	assert.match(out, /5m .*整段重写 2 次/);
});

test("ledger：有坏行照样算，退出码 1；一条能算的都没有就是用法错误", () => {
	const { out, code } = ledger(`${buildDemoSession()}{oops\n`);
	assert.equal(code, EXIT.badLines);
	assert.match(out, /有 1 行没读进来/);
	assert.throws(() => ledger("{oops\n"), UsageError);
});

test("compaction：参数传进模拟；不合理的场景变成用法错误", () => {
	assert.match(compaction([]), /压缩 5 次/);
	assert.match(compaction(["--reserve", "24576"]), /预留 24,576/);
	assert.match(compaction(["--turns", "50"]), /回本/);
	assert.throws(() => compaction(["--reserve", "300000"]), UsageError);
});

test("truncation 与 effort：数字和正文一致", () => {
	assert.match(truncation([]), /12,000 行.*按字节上限截到 952 行/);
	const e = effort();
	assert.match(e, /minimax-code .*只是投影/);
	assert.match(e, /kimi-code .*可用/);
	assert.doesNotMatch(e, /作者周（推断/);
	assert.match(effort(["--new-lines", "57343"]), /按 deepseek-harness +39\.9 作者周/);
});

test("命令行：未知命令和读不到的文件退出码 2，错误写到 stderr", () => {
	const bad = run("nope");
	assert.equal(bad.status, EXIT.usage);
	assert.match(bad.stderr, /用法/);
	const missing = run("ledger", "/no/such/file.jsonl");
	assert.equal(missing.status, EXIT.usage);
	assert.match(missing.stderr, /读不到文件/);
	const demo = run("demo");
	assert.equal(demo.status, 0);
	assert.equal(demo.stdout, buildDemoSession());
});
