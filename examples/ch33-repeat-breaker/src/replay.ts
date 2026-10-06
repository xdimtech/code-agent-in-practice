/**
 * 回放：读一份 JSONL 轨迹（一行一步），交给 runSteps，再汇总。
 *
 * 一行的形状：
 *
 *   {"calls": [{"id": "c1", "tool": "Read", "args": {"path": "a.ts"}}], "results": [{"id": "c1", "text": "...", "isError": false}]}
 *
 * `args` 是解析好的参数；也可以给 `arguments`（模型的原文字符串），用来模拟被截断的调用。
 * `calls` 为空表示这一步只有文字。轨迹是外部数据：坏一行就整份拒绝并报行号，不跳过、不猜。
 */

import type { BreakerConfig } from "./config.ts";
import { runSteps, type RunReport, type Step } from "./turn.ts";
import type { ToolCall, ToolOutput } from "./types.ts";

export class TrajectoryError extends Error {}

export interface Summary {
	readonly turns: number;
	readonly steps: number;
	readonly executed: number;
	readonly shared: number;
	readonly vetoed: number;
	readonly reminders: { readonly r1: number; readonly r2: number; readonly r3: number };
	readonly stops: number;
	readonly cycles: number;
	readonly turnRepeats: number;
}

export interface ReplayReport extends RunReport {
	readonly summary: Summary;
}

export function parseTrajectory(text: string): readonly Step[] {
	const steps: Step[] = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.trim();
		if (line === "") continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			throw new TrajectoryError(`第 ${i + 1} 行不是合法的 JSON`);
		}
		const problem = stepProblem(raw);
		if (problem) throw new TrajectoryError(`第 ${i + 1} 行：${problem}`);
		steps.push(toStep(raw as RawStep));
	}
	if (steps.length === 0) throw new TrajectoryError("轨迹是空的：一步都没有");
	return steps;
}

interface RawResult extends ToolOutput {
	readonly id: string;
}

interface RawStep {
	readonly calls: readonly ToolCall[];
	readonly results?: readonly RawResult[];
}

function toStep(raw: RawStep): Step {
	const outputs = new Map((raw.results ?? []).map((r) => [r.id, { text: r.text, isError: r.isError }] as const));
	return { calls: raw.calls, outputs };
}

function stepProblem(raw: unknown): string | undefined {
	if (!isRecord(raw)) return "每一行要是一个对象";
	if (!Array.isArray(raw.calls) || !raw.calls.every(isCall)) return "calls 要是 { id, tool, args | arguments } 的数组";
	if (raw.results !== undefined && (!Array.isArray(raw.results) || !raw.results.every(isResult))) return "results 要是 { id, text, isError } 的数组";
	const ids = new Set((raw.calls as ToolCall[]).map((c) => c.id));
	if (ids.size !== raw.calls.length) return "calls 里有重复的 id";
	const orphan = ((raw.results ?? []) as RawResult[]).find((r) => !ids.has(r.id));
	if (orphan) return `结果 ${orphan.id} 找不到对应的 call`;
	return undefined;
}

function isCall(v: unknown): v is ToolCall {
	if (!isRecord(v) || !isNonEmpty(v.id) || !isNonEmpty(v.tool)) return false;
	const hasArgs = "args" in v;
	const hasRaw = "arguments" in v;
	if (hasArgs === hasRaw) return false;
	return !hasRaw || typeof v.arguments === "string";
}

function isResult(v: unknown): v is RawResult {
	return isRecord(v) && isNonEmpty(v.id) && typeof v.text === "string" && typeof v.isError === "boolean";
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmpty(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

export function replay(config: BreakerConfig, steps: readonly Step[]): ReplayReport {
	const run = runSteps(config, steps);
	return { ...run, summary: summarize(run) };
}

export function summarize(run: RunReport): Summary {
	const events = run.steps.flatMap((s) => s.events);
	const results = run.steps.flatMap((s) => s.results.map((r) => ({ r, handoff: s.handoff })));
	const repeats = events.filter((e) => e.kind === "repeat");
	const count = (action: string) => repeats.filter((e) => e.action === action).length;
	return {
		turns: run.turns.length,
		steps: run.steps.length,
		executed: results.filter(({ r }) => r.executed).length,
		shared: results.filter(({ r, handoff }) => !r.executed && !handoff).length,
		vetoed: results.filter(({ r, handoff }) => !r.executed && handoff).length,
		reminders: { r1: count("r1"), r2: count("r2"), r3: count("r3") },
		stops: count("stop"),
		cycles: events.filter((e) => e.kind === "cycle").length,
		turnRepeats: events.filter((e) => e.kind === "turn_repeat").length,
	};
}

export function intervened(summary: Summary): boolean {
	const { r1, r2, r3 } = summary.reminders;
	return r1 + r2 + r3 + summary.stops + summary.cycles + summary.vetoed > 0;
}
