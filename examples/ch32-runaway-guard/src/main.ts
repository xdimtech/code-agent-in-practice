/**
 * 命令行入口。
 *
 *   runaway-guard <trajectory.jsonl> [--local f.json] [--remote f.json] [--shadow] [--json]
 *
 * 退出码：0 整条轨迹没有提醒、没有停；1 有提醒或触到硬上限；2 用法、配置或轨迹有问题。
 * 1 和 0 分开，是为了把它当回归闸门用：「这条轨迹必须提醒」「这条不许提醒」。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CONFIG, resolveConfig, type GuardConfig } from "./config.ts";
import { parseTrajectory, replay, TrajectoryError, type ReplayReport } from "./replay.ts";

export const EXIT = { quiet: 0, triggered: 1, usage: 2 } as const;

export class UsageError extends Error {}

export interface Options {
	readonly trajectory: string;
	readonly local?: string;
	readonly remote?: string;
	readonly shadow: boolean;
	readonly json: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
	let local: string | undefined;
	let remote: string | undefined;
	let shadow = false;
	let json = false;
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--local" || arg === "--remote") {
			const value = argv[++i];
			if (!value) throw new UsageError(`${arg} 后面要跟配置文件的路径`);
			if (arg === "--local") local = value;
			else remote = value;
		} else if (arg === "--shadow") shadow = true;
		else if (arg === "--json") json = true;
		else if (arg.startsWith("-")) throw new UsageError(`看不懂的参数：${arg}`);
		else rest.push(arg);
	}
	if (rest.length !== 1) throw new UsageError("要给且只给一份轨迹文件（JSONL，一行一步）");
	return { trajectory: rest[0]!, shadow, json, ...(local ? { local } : {}), ...(remote ? { remote } : {}) };
}

/** 本地配置读不了是用法错误；远端配置读不了只是「没覆盖」——和 minimax-code 一样 */
export function loadConfig(options: Options): GuardConfig {
	const local = options.local === undefined ? undefined : readJson(options.local);
	const remote = options.remote === undefined ? undefined : readJsonOrUndefined(options.remote);
	const config = resolveConfig(local, remote, DEFAULT_CONFIG);
	return options.shadow ? { ...config, shadow: true } : config;
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new UsageError(`读不了配置 ${path}：${(error as Error).message}`);
	}
}

function readJsonOrUndefined(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

export function renderReport(config: GuardConfig, report: ReplayReport): string {
	const s = report.summary;
	const mode = !config.enabled ? "关闭" : config.shadow ? "只观测" : `阈值 ${config.threshold}`;
	const lines = [`runaway-guard：${s.steps} 步，${mode}${config.maxSteps ? `，硬上限 ${config.maxSteps}` : ""}`];
	const rows = [
		...report.observations.map((o) => ({ step: o.step, order: 0, text: `  观测  第 ${o.step} 步  ${o.signal}` })),
		...report.events.map((e) => ({
			step: e.step,
			order: 1,
			text: e.decision.kind === "remind" ? `  提醒  第 ${e.step} 步  ${e.decision.signal}` : `  停止  第 ${e.step} 步  ${e.decision.reason}`,
		})),
	];
	for (const row of rows.toSorted((x, y) => x.step - y.step || x.order - y.order)) lines.push(row.text);
	const peaks = Object.entries(s.maxOccurrences).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
	lines.push(`  峰值  ${peaks.length > 0 ? peaks.join(" ") : "无"}`);
	if (s.skippedFingerprints > 0) lines.push(`  跳过  ${s.skippedFingerprints} 个指纹没算出来（超预算或不可序列化）`);
	lines.push(report.events.length === 0 ? "没有提醒。" : `共 ${report.events.length} 次干预。`);
	return lines.join("\n");
}

function run(argv: readonly string[]): number {
	const options = parseArgs(argv);
	const config = loadConfig(options);
	let text: string;
	try {
		text = readFileSync(options.trajectory, "utf8");
	} catch (error) {
		throw new UsageError(`读不了轨迹 ${options.trajectory}：${(error as Error).message}`);
	}
	const report = replay(config, parseTrajectory(text));
	console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(config, report));
	return report.events.length === 0 ? EXIT.quiet : EXIT.triggered;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof UsageError) && !(error instanceof TrajectoryError)) throw error;
		console.error(`runaway-guard：${error.message}`);
		process.exitCode = EXIT.usage;
	}
}
