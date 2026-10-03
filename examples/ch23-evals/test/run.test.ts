import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { latestRun, parseArgs, selectCases, syntheticTokens, toRecord, main } from "../src/run.ts";
import { CASES, runHarness } from "../src/cases.ts";
import { candidateHarness } from "../src/tools.ts";
import { parseRuns } from "../src/recorder.ts";

const RUN_TS = resolve(fileURLToPath(import.meta.url), "../../src/run.ts");

function withTempDir(run: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "ch23-cli-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("默认命令是 run，默认重复两次", () => {
	const options = parseArgs([]);
	assert.equal(options.command, "run");
	assert.equal(options.repetitions, 2);
	assert.equal(options.out, ".eval");
	assert.equal(options.gate, false);
	assert.equal(options.usage, false);
});

test("选项两种写法都认：--out 后面跟值", () => {
	const options = parseArgs(["run", "--out", "/tmp/x", "--repetitions", "3", "--gate", "--usage"]);
	assert.equal(options.out, "/tmp/x");
	assert.equal(options.repetitions, 3);
	assert.equal(options.gate, true);
	assert.equal(options.usage, true);
});

test("重复次数必须是正整数：0 次会得到一份空报告，还不如直接报错", () => {
	assert.throws(() => parseArgs(["run", "--repetitions", "0"]), /正整数/);
	assert.throws(() => parseArgs(["run", "--repetitions", "abc"]), /正整数/);
});

test("--case 可以给多个，认不出的用例直接报错并列出可用的", () => {
	const options = parseArgs(["run", "--case", "hello-extension", "--case", "escape-workspace"]);
	assert.deepEqual(options.cases, ["hello-extension", "escape-workspace"]);
	assert.throws(() => selectCases(["nope"]), /没有这个用例：nope/);
});

test("不认识的选项报错，不当成位置参数吞掉", () => {
	assert.throws(() => parseArgs(["run", "--verbose"]), /不认识的选项：--verbose/);
});

test("show 的 runId 走位置参数，不用起选项名", () => {
	const options = parseArgs(["show", "2026-10-04T00-00-00-000Z-ab12cd"]);
	assert.equal(options.command, "show");
	assert.deepEqual(options.positional, ["2026-10-04T00-00-00-000Z-ab12cd"]);
});

test("selectCases 保持用例原来的顺序，不受 --case 的书写顺序影响", () => {
	const selected = selectCases(["escape-workspace", "hello-extension"]);
	assert.deepEqual(
		selected.map((item) => item.id),
		["hello-extension", "escape-workspace"],
	);
});

test("估计 token 跟脚本长短成比例，工具调用本身也算进去", () => {
	// 用例一的两段脚本只差开头那次 list_files：差出来的估计值全来自那一次调用的参数
	const [long, short] = runHarness({ harness: candidateHarness, cases: [CASES[0]], repetitions: 2 });
	assert.ok(syntheticTokens(long) > syntheticTokens(short));
	assert.equal(Number.isInteger(syntheticTokens(short)), true);
});

test("记录里带 runId、schemaVersion 和用例的原始请求，产物拿给人也看得懂", () => {
	const run = runHarness({ harness: candidateHarness, cases: [CASES[2]], repetitions: 1 })[0];
	const record = toRecord(run, "run-42", false);
	assert.equal(record.case, "escape-workspace");
	assert.equal(record.harness, "careful-write");
	assert.equal(record.score, 1);
	assert.equal(record.input, CASES[2].prompt);
	assert.equal(record.observation.groupKey, "escape-workspace#0");
});

test("脚本抛异常的运行不记分数，记成崩了", () => {
	const broken = { ...CASES[0], scripts: [["tool: 不存在的工具 {}"]] };
	const run = runHarness({ harness: candidateHarness, cases: [broken], repetitions: 1 })[0];
	assert.ok(run.scriptError);
	assert.equal(run.verdict.score, 0);
	const record = toRecord(run, "run-43", false);
	assert.equal(record.score, undefined);
	assert.equal(record.observation.errored, true);
});

test("端到端：run 写产物、compare 读回来、show 打出轨迹", () => {
	withTempDir((directory) => {
		const runCode = main(["run", "--out", directory, "--repetitions", "1"]);
		assert.equal(runCode, 0);
		const path = join(directory, "runs.jsonl");
		assert.equal(existsSync(path), true);

		const records = parseRuns(readFileSync(path, "utf8"));
		assert.equal(records.length, 6);
		assert.equal(records.every((record) => record.runId === records[0].runId), true);

		assert.equal(main(["compare", "--out", directory]), 0);
		assert.equal(main(["show", records[0].runId.slice(0, 10), "--out", directory]), 0);
	});
});

test("run 自己建的产物目录是 0700：入口不能抢先用默认权限建一次", () => {
	withTempDir((directory) => {
		const outputDir = join(directory, "fresh", "eval");
		assert.equal(main(["run", "--out", outputDir, "--repetitions", "1"]), 0);
		assert.equal(statSync(outputDir).mode & 0o777, 0o700);
		assert.equal(statSync(join(outputDir, "runs.jsonl")).mode & 0o777, 0o600);
	});
});

test("端到端：--gate 在没有候选变差时也是 0", () => {
	withTempDir((directory) => {
		assert.equal(main(["run", "--out", directory, "--repetitions", "1"]), 0);
		assert.equal(main(["compare", "--out", directory, "--gate"]), 0);
	});
});

test("同一个目录跑两次，compare 只比最后一批：两批混着比，每组都会变成「重复观测」", () => {
	withTempDir((directory) => {
		assert.equal(main(["run", "--out", directory, "--repetitions", "1"]), 0);
		assert.equal(main(["run", "--out", directory, "--repetitions", "1"]), 0);
		const records = parseRuns(readFileSync(join(directory, "runs.jsonl"), "utf8"));
		assert.equal(records.length, 12);
		const latest = latestRun(records);
		assert.equal(latest.records.length, 6);
		assert.equal(latest.skipped, 1);
		assert.equal(latest.runId, records[11].runId);
		assert.equal(main(["compare", "--out", directory, "--gate"]), 0);
	});
});

test("--gate 下一对都配不上就是红的：没法比不等于没变差", () => {
	withTempDir((directory) => {
		assert.equal(main(["run", "--out", directory, "--repetitions", "1", "--case", "patch-existing"]), 0);
		// 手工删掉候选那一条，模拟「候选整批没跑出来」
		const path = join(directory, "runs.jsonl");
		const kept = readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line !== "" && !line.includes('"harness":"careful-write"'));
		writeFileSync(path, `${kept.join("\n")}\n`);
		assert.equal(main(["compare", "--out", directory]), 0);
		assert.equal(main(["compare", "--out", directory, "--gate"]), 1);
	});
});

test("latestRun 碰到空产物不崩", () => {
	assert.deepEqual(latestRun([]), { runId: undefined, records: [], skipped: 0 });
});

test("没有产物时 compare 说清楚要先跑 run，不是抛一句 undefined", () => {
	withTempDir((directory) => {
		assert.throws(() => main(["compare", "--out", directory]), /先跑一次 run/);
	});
});

test("命令行真的跑得起来：--help 有输出，退出码 0", () => {
	const output = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", RUN_TS, "--help"], {
		encoding: "utf8",
	});
	assert.ok(output.includes("compare"));
	assert.ok(output.includes("--gate"));
});

test("命令行跑一次真运行，退出码 0，产物真写出来了", () => {
	withTempDir((directory) => {
		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", RUN_TS, "run", "--out", directory, "--repetitions", "1"],
			{ encoding: "utf8" },
		);
		assert.ok(output.includes("工具边界"));
		assert.ok(output.includes("careful-write"));
		assert.equal(parseRuns(readFileSync(join(directory, "runs.jsonl"), "utf8")).length, 6);
	});
});
