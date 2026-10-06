/**
 * 把一串步驱动成若干轮：这就是宿主循环里和断路器有关的那一小部分。
 *
 * - 一步没有工具调用（只有文字），这一轮正常结束；
 * - 断路器要求结束这一轮时，如果交接还没给过，下一步就是交接步；
 * - 设了步数上限时，超过上限的一步不再开始，这一轮以 max_steps 结束——唯独交接步绕过上限（kimi-code `loopService.ts:970-991` 的 `!consumed.bypass`）；
 * - 一轮结束后，下一步属于新的一轮，断路器的状态全部清零。
 */

import type { BreakerConfig } from "./config.ts";
import { dropHandoff, planStep, settleStep, startTurn, type BreakerState } from "./breaker.ts";
import type { BreakerEvent, SettledResult, ToolCall, ToolOutput } from "./types.ts";

export interface Step {
	readonly calls: readonly ToolCall[];
	/** 执行过的调用的输出；没给的当作空输出 */
	readonly outputs: ReadonlyMap<string, ToolOutput>;
}

export type TurnEnd = "text" | "repeat_breaker" | "max_steps" | "incomplete";

export interface StepRecord {
	readonly turn: number;
	readonly step: number;
	readonly handoff: boolean;
	readonly results: readonly SettledResult[];
	readonly events: readonly BreakerEvent[];
}

export interface TurnRecord {
	readonly turn: number;
	readonly steps: number;
	readonly end: TurnEnd;
	/** 断路器要了交接，轨迹却在交接之前就结束了 */
	readonly handoffDropped: boolean;
}

export interface RunReport {
	readonly steps: readonly StepRecord[];
	readonly turns: readonly TurnRecord[];
}

interface Cursor {
	readonly turn: number;
	readonly state: BreakerState;
}

export function runSteps(config: BreakerConfig, steps: readonly Step[]): RunReport {
	const records: StepRecord[] = [];
	const turns: TurnRecord[] = [];
	let cursor: Cursor = { turn: 1, state: startTurn() };
	const endTurn = (end: TurnEnd): void => {
		turns.push({ turn: cursor.turn, steps: cursor.state.step, end, handoffDropped: false });
		cursor = { turn: cursor.turn + 1, state: startTurn() };
	};

	for (const step of steps) {
		if (overLimit(config, cursor.state)) endTurn("max_steps");
		const plan = planStep(cursor.state, step.calls);
		const settled = settleStep(config, plan, step.outputs);
		records.push({ turn: cursor.turn, step: settled.state.step, handoff: plan.handoffStep, results: settled.results, events: settled.events });
		cursor = { ...cursor, state: settled.state };
		if (plan.handoffStep) endTurn("repeat_breaker");
		else if (step.calls.length === 0) endTurn("text");
		else if (settled.stopTurn && settled.state.handoff !== "pending") endTurn("repeat_breaker");
	}

	if (cursor.state.step > 0) {
		const dropped = dropHandoff(cursor.state);
		turns.push({ turn: cursor.turn, steps: cursor.state.step, end: "incomplete", handoffDropped: dropped.events.length > 0 });
	}
	return { steps: records, turns };
}

/** 下一步会不会超过上限。交接步不受上限约束 */
function overLimit(config: BreakerConfig, state: BreakerState): boolean {
	if (config.maxSteps === undefined || state.handoff === "pending") return false;
	return state.step + 1 > config.maxSteps;
}
