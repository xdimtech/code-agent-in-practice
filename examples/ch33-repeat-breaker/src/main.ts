/**
 * 命令行入口。
 *
 *   repeat-breaker <trajectory.jsonl> [--kimi] [--max-steps N] [--thresholds 3,5,8,12] [--json]
 *
 * `--kimi` 关掉本例新增的交替检测，行为与 kimi-code 一致。
 * 退出码：0 整条轨迹没有任何干预；1 有提醒、真停或否决；2 用法、配置或轨迹有问题。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, DEFAULT_CONFIG, validateConfig, type BreakerConfig } from "./config.ts";
import { intervened, parseTrajectory, replay, TrajectoryError, type ReplayReport } from "./replay.ts";
import type { BreakerEvent } from "./types.ts";

export const EXIT = { quiet: 0, intervened: 1, usage: 2 } as const;

export class UsageError extends Error {}

export interface Options {
	readonly trajectory: string;
	readonly config: BreakerConfig;
	readonly json: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
	let config: BreakerConfig = DEFAULT_CONFIG;
	let json = false;
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--kimi") config = { ...config, cycle: { ...config.cycle, enabled: false } };
		else if (arg === "--json") json = true;
		else if (arg === "--max-steps") config = { ...config, maxSteps: parseInteger(arg, argv[++i]) };
		else if (arg === "--thresholds") config = { ...config, ...parseThresholds(argv[++i]) };
		else if (arg.startsWith("-")) throw new UsageError(`看不懂的参数：${arg}`);
		else rest.push(arg);
	}
	if (rest.length !== 1) throw new UsageError("要给且只给一份轨迹文件（JSONL，一行一步）");
	try {
		return { trajectory: rest[0]!, config: validateConfig(config), json };
	} catch (error) {
		if (error instanceof ConfigError) throw new UsageError(error.message);
		throw error;
	}
}

function parseInteger(flag: string, value: string | undefined): number {
	if (value === undefined || !/^\d+$/.test(value)) throw new UsageError(`${flag} 后面要跟一个正整数`);
	return Number(value);
}

function parseThresholds(value: string | undefined): Pick<BreakerConfig, "remind1" | "remind2" | "remind3" | "stopAt"> {
	const parts = (value ?? "").split(",");
	if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) throw new UsageError("--thresholds 要写成四个整数，例如 3,5,8,12");
	const [remind1, remind2, remind3, stopAt] = parts.map(Number) as [number, number, number, number];
	return { remind1, remind2, remind3, stopAt };
}

const ACTION_LABEL = { none: "", r1: "提醒 1", r2: "提醒 2", r3: "提醒 3", stop: "停止，下一步只许写字" } as const;
const END_LABEL = { text: "文字回复", repeat_breaker: "断路器", max_steps: "步数上限", incomplete: "轨迹结束" } as const;

function eventLine(event: BreakerEvent): string | undefined {
	switch (event.kind) {
		case "repeat":
			return event.action === "none" ? undefined : `${event.tool}  连续 ${event.streak} 次 → ${ACTION_LABEL[event.action]}`;
		case "dedup":
			return event.dupType === "same_step" ? `${event.tool}  同一步重复，共享结果，不执行` : undefined;
		case "cycle":
			return `交替  ${event.period} 个一组重复 ${event.repeats} 遍 → 提醒`;
		case "handoff":
			return event.outcome === "vetoed" ? "交接  调用了工具 → 否决，结束这一轮" : "交接  文字回复";
		case "turn_repeat":
			return undefined;
	}
}

export function renderReport(config: BreakerConfig, report: ReplayReport): string {
	const cycle = config.cycle.enabled ? `交替检测 开（每组 ≤${config.cycle.maxPeriod} 个，${config.cycle.repeats} 遍）` : "交替检测 关（--kimi）";
	const limit = config.maxSteps === undefined ? "不设步数上限" : `步数上限 ${config.maxSteps}`;
	const s = report.summary;
	const lines = [`repeat-breaker：${s.turns} 轮 ${s.steps} 步；阈值 ${config.remind1}/${config.remind2}/${config.remind3}/${config.stopAt}，${cycle}，${limit}`];
	for (const turn of report.turns) {
		for (const step of report.steps.filter((x) => x.turn === turn.turn)) {
			for (const text of step.events.map(eventLine).filter((t) => t !== undefined)) lines.push(`  第 ${turn.turn} 轮 第 ${step.step} 步  ${text}`);
		}
		lines.push(`  第 ${turn.turn} 轮结束：${END_LABEL[turn.end]}（${turn.steps} 步）${turn.handoffDropped ? "，交接没来得及发生" : ""}`);
	}
	const { r1, r2, r3 } = s.reminders;
	lines.push(`  合计  执行 ${s.executed}  共享 ${s.shared}  否决 ${s.vetoed}  提醒 ${r1}/${r2}/${r3}  停止 ${s.stops}  交替 ${s.cycles}  跨步再现 ${s.turnRepeats}`);
	lines.push(intervened(s) ? "有干预。" : "没有干预。");
	return lines.join("\n");
}

function run(argv: readonly string[]): number {
	const options = parseArgs(argv);
	let text: string;
	try {
		text = readFileSync(options.trajectory, "utf8");
	} catch (error) {
		throw new UsageError(`读不了轨迹 ${options.trajectory}：${(error as Error).message}`);
	}
	const report = replay(options.config, parseTrajectory(text));
	console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(options.config, report));
	return intervened(report.summary) ? EXIT.intervened : EXIT.quiet;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof UsageError) && !(error instanceof TrajectoryError)) throw error;
		console.error(`repeat-breaker：${error.message}`);
		process.exitCode = EXIT.usage;
	}
}
