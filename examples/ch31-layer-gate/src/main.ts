/**
 * 命令行入口。
 *
 *   layer-gate --config <file> <root>   扫描仓库；--json 输出机器可读结果
 *   layer-gate --self-test              跑自测
 *
 * 退出码：0 通过；1 有违规（或自测失败）；2 用法、配置或扫描范围有问题。
 * 第三种和第二种分开，是因为「配置写错了」和「代码违规了」要找的人不一样。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfig } from "./config.ts";
import { scanRepo, type ScanReport } from "./scan.ts";
import { runSelfTest } from "./self-test.ts";
import type { GateConfig } from "./types.ts";

export const EXIT = { ok: 0, violations: 1, usage: 2 } as const;

export class UsageError extends Error {}

export type Options = { readonly mode: "self-test" } | { readonly mode: "scan"; readonly config: string; readonly root: string; readonly json: boolean };

export function parseArgs(argv: readonly string[]): Options {
	if (argv.length === 1 && argv[0] === "--self-test") return { mode: "self-test" };
	let config: string | undefined;
	let json = false;
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--config") {
			config = argv[++i];
			if (!config) throw new UsageError("--config 后面要跟配置文件的路径");
		} else if (arg === "--json") json = true;
		else if (arg.startsWith("-")) throw new UsageError(`看不懂的参数：${arg}`);
		else rest.push(arg);
	}
	if (!config) throw new UsageError("要用 --config 指定配置文件（或者用 --self-test 跑自测）");
	if (rest.length !== 1) throw new UsageError("要给且只给一个仓库根目录");
	return { mode: "scan", config, root: rest[0]!, json };
}

export function loadConfig(path: string): GateConfig {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new UsageError(`读不了配置 ${path}：${(error as Error).message}`);
	}
	const result = parseConfig(raw);
	if (!result.ok) throw new UsageError(`配置 ${path} 有 ${result.errors.length} 处错误：\n  ${result.errors.join("\n  ")}`);
	return result.config;
}

export function renderReport(report: ScanReport): string {
	const lines = [`layer-gate：扫了 ${report.files} 个文件、${report.imports} 条 import`];
	for (const f of report.findings) lines.push(`  ${f.kind.padEnd(20)} ${f.importer}:${f.line}  ${f.message}`);
	lines.push(report.findings.length === 0 ? "没有违规。" : `共 ${report.findings.length} 处违规。`);
	return lines.join("\n");
}

/** 扫描范围本身有问题时返回错误说明：这时「0 违规」不代表干净 */
export function scopeProblem(report: ScanReport): string | undefined {
	if (report.missingPaths.length > 0) return `配置里的这些目录不存在：${report.missingPaths.join("、")}——配置和仓库已经对不上了`;
	if (report.files === 0) return "一个源文件都没扫到：这是配置的问题，不是「没有违规」";
	return undefined;
}

function run(argv: readonly string[]): number {
	const options = parseArgs(argv);
	if (options.mode === "self-test") {
		const failures = runSelfTest();
		for (const failure of failures) console.error(`  ✗ ${failure}`);
		console.log(failures.length === 0 ? "layer-gate 自测通过。" : `layer-gate 自测失败 ${failures.length} 项。`);
		return failures.length === 0 ? EXIT.ok : EXIT.violations;
	}
	const report = scanRepo(resolve(options.root), loadConfig(options.config));
	const problem = scopeProblem(report);
	if (problem) throw new UsageError(problem);
	console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(report));
	return report.findings.length === 0 ? EXIT.ok : EXIT.violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(`layer-gate：${error.message}`);
		process.exitCode = EXIT.usage;
	}
}
