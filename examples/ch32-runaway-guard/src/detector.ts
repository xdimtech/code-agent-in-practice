/**
 * 检测：每一步更新五组连击，外加一个只观测的 ABAB。
 *
 * 纯函数：observeStep(旧状态, 这一步) → { 新状态, 观测, 提醒候选 }。旧状态不被修改。
 *
 * 「连击」是连续的：这一步没出现的键，计数直接清掉。
 * 观测从第 2 次开始记（越过 2 的那一步记一次）；提醒候选在越过阈值的那一步产生一次。
 */

import { errorFamily, isExpectedNoMatch } from "./errors.ts";
import { fingerprint } from "./fingerprint.ts";
import type { Observation, RemindableKind, SignalKind, Step, ToolCall, ToolKind, ToolResult } from "./types.ts";

export const OBSERVE_FROM = 2;

type Counts = ReadonlyMap<string, number>;

export interface DetectorState {
	readonly secret: Buffer;
	readonly step: number;
	/** 指纹算不出来（超预算、有环……）而跳过的次数 */
	readonly skipped: number;
	readonly action: Counts;
	readonly polling: Counts;
	readonly result: Counts;
	readonly error: Counts;
	readonly progress: ReadonlyMap<string, { readonly state: string; readonly occurrences: number }>;
	readonly recentBatches: readonly string[];
	readonly activeAbab?: string;
	readonly maxOccurrences: Readonly<Record<SignalKind, number>>;
}

export interface StepOutcome {
	readonly state: DetectorState;
	readonly observations: readonly Observation[];
	readonly candidates: ReadonlySet<RemindableKind>;
}

export function newDetectorState(secret: Buffer): DetectorState {
	const empty = new Map<string, number>();
	return {
		secret,
		step: 0,
		skipped: 0,
		action: empty,
		polling: empty,
		result: empty,
		error: empty,
		progress: new Map(),
		recentBatches: [],
		maxOccurrences: { action_repeat: 0, polling_repeat: 0, result_repeat: 0, error_family: 0, no_progress: 0, abab: 0 },
	};
}

interface StepKeys {
	readonly action: readonly string[];
	readonly polling: readonly string[];
	readonly result: readonly string[];
	readonly error: readonly string[];
	readonly skipped: number;
}

/** 把一步投影成几组指纹；只有这里看参数和结果的原文 */
export function projectStep(secret: Buffer, step: Step, kindOf: (tool: string) => ToolKind): StepKeys {
	const results = new Map(step.results.map((r) => [r.id, r]));
	const keys = { action: [] as string[], polling: [] as string[], result: [] as string[], error: [] as string[] };
	let skipped = 0;
	const push = (bucket: string[], value: unknown): string | undefined => {
		const key = fingerprint(secret, value);
		if (key === undefined) skipped++;
		else bucket.push(key);
		return key;
	};
	for (const call of step.calls) {
		const kind = kindOf(call.tool);
		const result = results.get(call.id);
		if (kind === "exempt") continue;
		if (kind === "polling") {
			// 轮询只关心「同一个问题得到同一个回答」；回答变了就不是空转
			push(keys.polling, { tool: call.tool, args: call.args, answer: result?.text ?? null });
			continue;
		}
		const action = push(keys.action, { tool: call.tool, args: call.args });
		if (!result) continue;
		push(keys.result, { tool: call.tool, isError: result.isError, text: result.text, code: result.code ?? null });
		const family = errorKey(call, result);
		if (family && action) push(keys.error, { family, action });
	}
	return { ...keys, skipped };
}

function errorKey(call: ToolCall, result: ToolResult): string | undefined {
	if (!result.isError || isExpectedNoMatch(call, result)) return undefined;
	return errorFamily(call.tool, result);
}

export function observeStep(prev: DetectorState, step: Step, kindOf: (tool: string) => ToolKind, threshold?: number): StepOutcome {
	const index = prev.step + 1;
	const keys = projectStep(prev.secret, step, kindOf);
	const observations: Observation[] = [];
	const candidates = new Set<RemindableKind>();
	const maxOccurrences = { ...prev.maxOccurrences };
	const note = (signal: SignalKind, before: number, now: number, remindable?: RemindableKind): void => {
		maxOccurrences[signal] = Math.max(maxOccurrences[signal], now);
		if (before < OBSERVE_FROM && now >= OBSERVE_FROM) observations.push({ step: index, signal, occurrences: OBSERVE_FROM });
		if (remindable && threshold !== undefined && before < threshold && now >= threshold) candidates.add(remindable);
	};
	const streak = (previous: Counts, current: readonly string[], signal: SignalKind, remindable?: RemindableKind): Counts => {
		const next = new Map<string, number>();
		for (const key of current) next.set(key, (next.get(key) ?? 0) + 1);
		for (const [key, count] of next) {
			const before = previous.get(key) ?? 0;
			next.set(key, before + count);
			note(signal, before, before + count, remindable);
		}
		return next;
	};

	const action = streak(prev.action, keys.action, "action_repeat", "action_repeat");
	const polling = streak(prev.polling, keys.polling, "polling_repeat", "polling_repeat");
	const result = streak(prev.result, keys.result, "result_repeat");
	const error = streak(prev.error, keys.error, "error_family", "error_family");

	const progress = new Map<string, { state: string; occurrences: number }>();
	for (const { target, state } of step.progress ?? []) {
		const before = prev.progress.get(target);
		const occurrences = before?.state === state ? before.occurrences + 1 : 1;
		progress.set(target, { state, occurrences });
		note("no_progress", before?.state === state ? before.occurrences : 0, occurrences, "no_progress");
	}

	const abab = observeAbab(prev, keys.action, index);
	if (abab.observed) {
		observations.push({ step: index, signal: "abab", occurrences: OBSERVE_FROM });
		maxOccurrences.abab = Math.max(maxOccurrences.abab, OBSERVE_FROM);
	}

	const state: DetectorState = {
		...prev,
		step: index,
		skipped: prev.skipped + keys.skipped,
		action,
		polling,
		result,
		error,
		progress,
		recentBatches: abab.recentBatches,
		activeAbab: abab.activeAbab,
		maxOccurrences,
	};
	return { state, observations, candidates };
}

/** A B A B：两批不同的动作交替。只观测，一段交替只记一次 */
function observeAbab(prev: DetectorState, actionKeys: readonly string[], index: number): { recentBatches: readonly string[]; activeAbab?: string; observed: boolean } {
	if (actionKeys.length === 0) return { recentBatches: [], observed: false };
	const batch = fingerprint(prev.secret, ["batch", ...[...actionKeys].sort()]) ?? `skipped:${index}`;
	const recentBatches = [...prev.recentBatches, batch].slice(-4);
	const [a, b, c, d] = recentBatches;
	if (recentBatches.length < 4 || a === b || a !== c || b !== d) return { recentBatches, observed: false };
	// 与顺序无关：窗口滑一格从 ABAB 变成 BABA，仍是同一段交替
	const episode = [a, b].sort().join("\u0000");
	if (prev.activeAbab === episode) return { recentBatches, activeAbab: episode, observed: false };
	return { recentBatches, activeAbab: episode, observed: true };
}
