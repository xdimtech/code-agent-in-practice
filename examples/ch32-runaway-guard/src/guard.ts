/**
 * 守卫：在检测之上加四条规则。
 *
 *   1. 一轮最多提醒一次；多个候选时按 REMINDABLE 的顺序选一个。
 *   2. 先占位再 steer：决定提醒的那一刻就记下「已尝试」，steer 失败也不重试。
 *   3. 失败放行：检测或 steer 抛错都不影响这一轮继续，但记进 failures——放行不等于没发生。
 *   4. 唯一会停的是可选的硬步数上限 maxSteps；提醒本身从不拒绝工具、不中止。
 *
 * 状态是不可变的：每个函数返回新的 TurnState。
 */

import type { GuardConfig } from "./config.ts";
import { newDetectorState, observeStep, type DetectorState } from "./detector.ts";
import { newSecret } from "./fingerprint.ts";
import { reminderText } from "./reminder.ts";
import { REMINDABLE, type Decision, type Observation, type RemindableKind, type SignalKind, type Step, type ToolKind } from "./types.ts";

export interface TurnState {
	readonly detector: DetectorState;
	readonly reminderAttempted: boolean;
	readonly reminderInjected: boolean;
	/** 检测或 steer 抛错、被放行的次数 */
	readonly failures: number;
}

export interface StepResult {
	readonly turn: TurnState;
	readonly decision: Decision;
	readonly observations: readonly Observation[];
}

export function startTurn(secret: Buffer = newSecret()): TurnState {
	return { detector: newDetectorState(secret), reminderAttempted: false, reminderInjected: false, failures: 0 };
}

export function kindOf(config: GuardConfig): (tool: string) => ToolKind {
	return (tool) => config.tools[tool] ?? "detect";
}

/** 纯判定：这一步之后要不要提醒、要不要停 */
export function decide(config: GuardConfig, turn: TurnState, step: Step): StepResult {
	if (!config.enabled) {
		// 关掉时清空连击：重新打开后从零数，不会因为关着期间的历史立刻提醒
		const cleared = { ...newDetectorState(turn.detector.secret), step: turn.detector.step + 1 };
		return { turn: { ...turn, detector: cleared }, decision: { kind: "continue" }, observations: [] };
	}
	const threshold = config.shadow ? undefined : config.threshold;
	const outcome = observeStep(turn.detector, step, kindOf(config), threshold);
	const next = { ...turn, detector: outcome.state };
	if (config.maxSteps !== undefined && outcome.state.step >= config.maxSteps) {
		return { turn: next, decision: { kind: "stop", reason: `已经跑了 ${outcome.state.step} 步，达到上限 ${config.maxSteps}` }, observations: outcome.observations };
	}
	const signal = pickSignal(outcome.candidates);
	if (!signal || turn.reminderAttempted) return { turn: next, decision: { kind: "continue" }, observations: outcome.observations };
	// 规则 2：在交给调用方 steer 之前就占位
	return {
		turn: { ...next, reminderAttempted: true },
		decision: { kind: "remind", signal, content: reminderText(signal, config.threshold) },
		observations: outcome.observations,
	};
}

export function pickSignal(candidates: ReadonlySet<RemindableKind>): RemindableKind | undefined {
	return REMINDABLE.find((kind) => candidates.has(kind));
}

/** 一步的完整处理：判定 + steer，任何异常都放行并记账 */
export function guardStep(config: GuardConfig, turn: TurnState, step: Step, steer: (content: string) => void): StepResult {
	let result: StepResult;
	try {
		result = decide(config, turn, step);
	} catch {
		return { turn: { ...turn, failures: turn.failures + 1 }, decision: { kind: "continue" }, observations: [] };
	}
	if (result.decision.kind !== "remind") return result;
	try {
		steer(result.decision.content);
		return { ...result, turn: { ...result.turn, reminderInjected: true } };
	} catch {
		return { ...result, turn: { ...result.turn, failures: result.turn.failures + 1 } };
	}
}

export interface TurnSummary {
	readonly steps: number;
	readonly skippedFingerprints: number;
	readonly reminderAttempted: boolean;
	readonly reminderInjected: boolean;
	readonly failures: number;
	readonly maxOccurrences: Readonly<Record<SignalKind, number>>;
}

/** 一轮结束时交给遥测的东西：只有计数，没有参数、结果和指纹 */
export function summarize(turn: TurnState): TurnSummary {
	return {
		steps: turn.detector.step,
		skippedFingerprints: turn.detector.skipped,
		reminderAttempted: turn.reminderAttempted,
		reminderInjected: turn.reminderInjected,
		failures: turn.failures,
		maxOccurrences: turn.detector.maxOccurrences,
	};
}
