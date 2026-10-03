/**
 * 命令行：跑一批，落一份产物，再做一次成对对比。
 *
 * 三个子命令，对应 eval 这套东西的三件正经事：
 *
 *   run        跑全部方案，写 runs.jsonl，打一份汇总（分数是拿来读的，不是拿来红的）
 *   compare    读回 runs.jsonl，做成对对比。--gate 时才在候选变差的时候返回非零
 *   show       读回一条轨迹，人肉看看它到底干了什么
 *
 * 为什么把「跑」和「比」拆成两个子命令：产物是纯文本，可以进版本库、可以在 CI 里下载、
 * 可以拿去跟上周的那份比。跑一次比一次的成本差别很大（这个例子是假的，真项目里要花钱），
 * 拆开之后重比不用重跑。
 *
 * 关于 token / 耗时 / 费用：这个例子的模型是脚本，没有真调用，所以这三个数默认是
 * 「不可用」——缺席就是没测到，不是 0（`summary.ts:212-245` 也是这么处理的）。
 * 想看报告长什么样、又清楚这些数不是测出来的，加 --usage。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { BASELINE, CANDIDATE, baselineHarness, candidateHarness } from "./tools.ts";
import type { EvalCase, CaseRun } from "./cases.ts";
import { CASES, EVAL_SET, runHarness } from "./cases.ts";
import { createRecorder, parseRuns, permissionWarning } from "./recorder.ts";
import type { RunRecord } from "./recorder.ts";
import { compare, renderReport } from "./score.ts";
import type { Harness } from "./harness.ts";
import type { Observation } from "./types.ts";

interface Options {
	readonly command: string;
	readonly out: string;
	readonly repetitions: number;
	readonly gate: boolean;
	/** 把按脚本推算的用量写进产物。默认关：没测到的数就该缺席 */
	readonly usage: boolean;
	readonly cases: readonly string[];
	readonly positional: readonly string[];
}

const USAGE = `用法：node --experimental-strip-types --no-warnings src/run.ts <命令> [选项]

命令
  run                 跑全部方案，写产物并打一份汇总
  compare             读回产物，做基线 vs 候选的成对对比
  show <runId>        按 runId 打印一条轨迹（用 show 加时间戳前缀可模糊匹配）

选项
  --out <目录>        产物目录（默认 .eval）
  --repetitions <n>   每个用例重复几次（默认 2）
  --usage             把 token / 耗时 / 费用按脚本推算后写进产物与报告。
                      这些数不是测出来的，只为看报告的格式
  --gate              候选比基线差时返回退出码 1。默认不红
  --case <id>         只跑某个用例，可以重复
`;

export function parseArgs(argv: readonly string[]): Options {
	const [command = "run", ...rest] = argv;
	let out = ".eval";
	let repetitions = 2;
	let gate = false;
	let usage = false;
	const cases: string[] = [];
	const positional: string[] = [];

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		const next = () => {
			index += 1;
			return rest[index];
		};
		if (token === "--out") out = next() ?? out;
		else if (token === "--repetitions") {
			const raw = Number(next());
			if (!Number.isInteger(raw) || raw < 1) throw new Error(`--repetitions 要是正整数，收到 ${raw}`);
			repetitions = raw;
		} else if (token === "--case") {
			const id = next();
			if (id === undefined) throw new Error("--case 后面要跟用例 id");
			cases.push(id);
		} else if (token === "--gate") gate = true;
		else if (token === "--usage") usage = true;
		else if (token.startsWith("--")) throw new Error(`不认识的选项：${token}`);
		else positional.push(token);
	}

	return { command, out, repetitions, gate, usage, cases, positional };
}

const HARNESSES: readonly Harness[] = [baselineHarness, candidateHarness];

export function selectCases(ids: readonly string[], all: readonly EvalCase[] = CASES): readonly EvalCase[] {
	if (ids.length === 0) return all;
	for (const id of ids) {
		if (!all.some((item) => item.id === id)) {
			throw new Error(`没有这个用例：${id}（有：${all.map((item) => item.id).join(", ")}）`);
		}
	}
	return all.filter((item) => ids.includes(item.id));
}

/** 脚本长度换算成 token。它不是用量，只是「跟脚本长短成比例的一个数」，见文件头 */
function syntheticTokens(run: CaseRun): number {
	const characters = run.result.events.reduce((sum, event) => {
		if (event.type === "response") return sum + event.content.length;
		if (event.type === "tool_call") return sum + JSON.stringify(event.args).length;
		return sum;
	}, 0);
	return Math.ceil(characters / 3);
}

export function observationOf(run: CaseRun, withUsage: boolean): Observation {
	return {
		evalSet: EVAL_SET,
		groupKey: `${run.evalCase.id}#${(run.repetition - 1) % run.evalCase.scripts.length}`,
		repetition: run.repetition,
		harness: run.harness.name,
		score: run.scriptError ? undefined : run.verdict.score,
		...(run.scriptError ? { errored: true } : {}),
		...(withUsage ? { totalTokens: syntheticTokens(run), totalMs: (run.result.usage.toolCalls ?? 0) * 40, estimatedCostUsd: syntheticTokens(run) * 0.000003 } : {}),
	};
}

function summarize(runs: readonly CaseRun[]): string {
	const lines: string[] = [`eval 集：${EVAL_SET}（${runs.length} 次运行）`];
	for (const harness of HARNESSES) {
		const mine = runs.filter((run) => run.harness.name === harness.name);
		const passed = mine.filter((run) => !run.scriptError && run.verdict.score >= 1).length;
		lines.push(`  ${harness.name.padEnd(16)} 通过 ${passed}/${mine.length}`);
		for (const run of mine) {
			const mark = run.scriptError ? "脚本错误" : run.verdict.score >= 1 ? "通过" : `未通过 ${run.verdict.score.toFixed(2)}`;
			lines.push(`    ${run.evalCase.id.padEnd(18)} 第 ${run.repetition} 次  ${mark}`);
			if (run.scriptError) lines.push(`      ${run.verdict.rationale}`);
			else if (run.verdict.score < 1) lines.push(`      ${run.verdict.rationale}`);
		}
	}
	return lines.join("\n");
}

export function toRecord(run: CaseRun, runId: string, withUsage: boolean): Omit<RunRecord, "schemaVersion" | "runId"> {
	const observation = observationOf(run, withUsage);
	return {
		evalSet: EVAL_SET,
		case: run.evalCase.id,
		harness: run.harness.name,
		repetition: run.repetition,
		input: run.evalCase.prompt,
		output: run.result.output,
		events: run.result.events,
		...(run.scriptError ? {} : { score: run.verdict.score, rationale: run.verdict.rationale }),
		usage: run.result.usage,
		observation,
	};
}

function runCommand(options: Options): number {
	const selected = selectCases(options.cases);
	const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
	const outputDir = resolve(options.out);
	const recorder = createRecorder({ outputDir, runId });
	const warning = permissionWarning(outputDir);
	if (warning) console.error(warning);

	const runs: CaseRun[] = [];
	for (const harness of HARNESSES) {
		runs.push(...runHarness({ harness, cases: selected, repetitions: options.repetitions }));
	}

	try {
		for (const run of runs) recorder.record(toRecord(run, runId, options.usage));
	} finally {
		recorder.close();
	}

	// 脚本抛异常也是「跑崩了」，不该把退出码变成 0 装作没事
	const scriptErrors = runs.filter((run) => run.scriptError);
	console.log(summarize(runs));
	console.log(`\n产物：${join(outputDir, "runs.jsonl")}（runId ${runId}）`);
	if (options.usage) console.log("提示：token / 耗时 / 费用三个数是按脚本推算的估计值，不是测出来的用量。");

	const report = compare(runs.map((run) => observationOf(run, options.usage)), { baseline: BASELINE, candidates: [CANDIDATE] });
	console.log(`\n${renderReport(report)}`);

	if (scriptErrors.length > 0) {
		console.error(`\n有 ${scriptErrors.length} 次运行是脚本自己抛了，先修脚本：`);
		for (const run of scriptErrors) console.error(`  ${run.evalCase.id} / 第 ${run.repetition} 次：${run.scriptError}`);
		return 1;
	}
	return 0;
}

function readRecords(options: Options): RunRecord[] {
	const path = join(resolve(options.out), "runs.jsonl");
	if (!existsSync(path)) {
		throw new Error(`没有产物：${path}，先跑一次 run`);
	}
	let broken = 0;
	const records = parseRuns(readFileSync(path, "utf8"), (line) => {
		broken += 1;
		console.error(`第 ${line} 行不是合法 JSON，跳过`);
	});
	if (broken > 0) console.error(`产物里有 ${broken} 行读不了，报告只覆盖读得懂的 ${records.length} 条。`);
	return records;
}

/**
 * runs.jsonl 是追加写的：同一个目录跑两次，里面就有两批。两批混在一起比，
 * 每一组都会有两条基线、两条候选，全被记成「重复观测」——一对也配不上。
 * 所以默认只比最后一批；要比更早的那批，用 show 先找到 runId 再说。
 */
export function latestRun(records: readonly RunRecord[]): { readonly runId: string | undefined; readonly records: readonly RunRecord[]; readonly skipped: number } {
	const runId = records.at(-1)?.runId;
	const latest = records.filter((record) => record.runId === runId);
	return { runId, records: latest, skipped: new Set(records.map((record) => record.runId)).size - (runId === undefined ? 0 : 1) };
}

function compareCommand(options: Options): number {
	const { runId, records, skipped } = latestRun(readRecords(options));
	console.log(`对比的是 runId ${runId ?? "（无）"}，共 ${records.length} 条${skipped > 0 ? `；更早的 ${skipped} 批没有参与` : ""}`);
	const observations = records.map((record) => record.observation);
	// 只比没崩的那些：崩溃单列，不然「候选把测试跑挂了」看起来像「候选变差了」
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] });
	console.log(renderReport(report));

	// 一对都没配上，不等于「没有变差」。--gate 下这种情况要红：沉默不是通过
	const incomparable = report.comparisons.filter((comparison) => comparison.lift === null);
	if (incomparable.length > 0) {
		const message = `有 ${incomparable.length} 个候选没法和基线比（一对都没配上），先看上面「没进对比的观测」`;
		if (!options.gate) {
			console.log(`\n${message}（没加 --gate，退出码仍是 0）`);
			return 0;
		}
		console.error(`\n${message}`);
		return 1;
	}

	const worst = report.comparisons.filter((comparison) => comparison.lift !== null && comparison.lift < 0);
	if (worst.length === 0) {
		console.log("\n没有候选项低于基线。");
		return 0;
	}
	const message = `有 ${worst.length} 个候选低于基线：${worst.map((item) => `${item.candidate} ${item.lift === null ? "" : item.lift.toFixed(4)}`).join(", ")}`;
	if (!options.gate) {
		console.log(`\n${message}（没加 --gate，退出码仍是 0）`);
		return 0;
	}
	console.error(`\n${message}`);
	return 1;
}

function showCommand(options: Options): number {
	const needle = options.positional[0];
	if (needle === undefined) throw new Error("show 后面要跟 runId（可以是前缀）");
	const records = readRecords(options);
	const matched = records.filter((record) => record.runId.startsWith(needle));
	if (matched.length === 0) throw new Error(`没有 runId 以 ${needle} 开头的运行`);

	console.log(`runId：${matched[0].runId}（${matched.length} 条记录）`);
	for (const record of matched) {
		console.log(`\n${record.case} / ${record.harness} / 第 ${record.repetition} 次  分数 ${record.score ?? "无"}`);
		console.log(`  输入：${record.input}`);
		console.log(`  输出：${record.output}`);
		for (const event of record.events) {
			if (event.type === "tool_call") console.log(`  调用：${event.name} ${JSON.stringify(event.args)}`);
			else if (event.type === "tool_result") console.log(`  结果：${event.name} ${event.result.ok ? "成功" : `失败（${event.result.error ?? "没给原因"}）`}`);
			else if (event.type === "error") console.log(`  报错：${event.message}`);
		}
		console.log(`  判分：${record.rationale ?? "（没有）"}`);
	}
	return 0;
}

function main(argv: readonly string[]): number {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	const options = parseArgs(argv);
	// 目录由 recorder 建（带 0700）。这里先建一次的话，mode 就落在默认的 0755 上了
	if (options.command === "run") return runCommand(options);
	if (options.command === "compare") return compareCommand(options);
	if (options.command === "show") return showCommand(options);
	console.error(`不认识的命令：${options.command}\n\n${USAGE}`);
	return 1;
}

// 直接 node src/run.ts 时 argv[1] 就是本文件；被测试 import 时不是。
// 用 resolve 比而不是字符串比，省得被 ./ 或 ../ 骗过去
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

export { main, summarize, syntheticTokens, HARNESSES };
