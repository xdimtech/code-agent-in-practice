/**
 * 回放：把一份录下来的轨迹（JSONL，一行一步）逐步喂给守卫。
 *
 * 用途是调阈值和做回归：同一份轨迹，换一组配置，看第几步会提醒、提醒的是哪一类。
 * 回放从不真的 steer（steer 是个记录函数），所以轨迹在提醒之后的部分照样会被看完。
 *
 * 输入是外部数据：每一行都校验，坏一行就整份拒绝，并报行号——不跳过、不猜。
 */

import type { GuardConfig } from "./config.ts";
import { guardStep, startTurn, summarize, type TurnSummary } from "./guard.ts";
import type { Decision, Observation, Step, ToolCall, ToolResult, Progress } from "./types.ts";

export class TrajectoryError extends Error {}

export interface ReplayEvent {
	readonly step: number;
	readonly decision: Exclude<Decision, { kind: "continue" }>;
}

export interface ReplayReport {
	readonly events: readonly ReplayEvent[];
	readonly observations: readonly Observation[];
	readonly summary: TurnSummary;
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
		steps.push(raw as Step);
	}
	if (steps.length === 0) throw new TrajectoryError("轨迹是空的：一步都没有");
	return steps;
}

function stepProblem(raw: unknown): string | undefined {
	if (!isRecord(raw)) return "每一行要是一个对象";
	if (!Array.isArray(raw.calls) || !raw.calls.every(isCall)) return "calls 要是 { id, tool, args } 的数组";
	if (!Array.isArray(raw.results) || !raw.results.every(isResult)) return "results 要是 { id, isError, text } 的数组";
	if (raw.progress !== undefined && (!Array.isArray(raw.progress) || !raw.progress.every(isProgress))) return "progress 要是 { target, state } 的数组";
	const ids = new Set((raw.calls as ToolCall[]).map((c) => c.id));
	if (ids.size !== raw.calls.length) return "calls 里有重复的 id";
	const orphan = (raw.results as ToolResult[]).find((r) => !ids.has(r.id));
	if (orphan) return `结果 ${orphan.id} 找不到对应的 call`;
	return undefined;
}

function isCall(v: unknown): v is ToolCall {
	return isRecord(v) && isNonEmpty(v.id) && isNonEmpty(v.tool) && "args" in v;
}

function isResult(v: unknown): v is ToolResult {
	return isRecord(v) && isNonEmpty(v.id) && typeof v.isError === "boolean" && typeof v.text === "string" && (v.code === undefined || typeof v.code === "string");
}

function isProgress(v: unknown): v is Progress {
	return isRecord(v) && isNonEmpty(v.target) && typeof v.state === "string";
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmpty(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

export function replay(config: GuardConfig, steps: readonly Step[], secret?: Buffer): ReplayReport {
	let turn = startTurn(secret);
	const events: ReplayEvent[] = [];
	const observations: Observation[] = [];
	for (const step of steps) {
		const result = guardStep(config, turn, step, () => {});
		turn = result.turn;
		observations.push(...result.observations);
		if (result.decision.kind !== "continue") events.push({ step: turn.detector.step, decision: result.decision });
		if (result.decision.kind === "stop") break;
	}
	return { events, observations, summary: summarize(turn) };
}
