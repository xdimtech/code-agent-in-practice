/**
 * 重复调用断路器：kimi-code `toolDedupeService.ts` 的不可变重写。
 *
 * 一步分两段：
 *
 *   planStep(旧状态, 这一步的调用)        → 哪些执行、哪些共享同一步更早的结果、哪些直接否决
 *   settleStep(配置, 计划, 执行的输出)    → 贴好提醒的结果、要不要结束这一轮、新状态
 *
 * 规则（括号里是 kimi-code 的位置）：
 *
 * 1. 同一步里键相同的调用只执行第一个，后面的拿同一份结果（:443-447）。
 * 2. 连续计数按「调用的先后」走，跨步延续；同一步里的重复也算进去（:367-376、:516-526）。
 * 3. 连续第 3 / 5 / 8 次起，把三级提醒贴在结果后面；第 12 次照样执行，贴最后一级提醒并结束这一轮（:528-543、:137-140）。
 * 4. 结束之后再给一步「只许写字」的交接，这一步绕过步数上限；这一步里的工具调用一律否决（:378-400、:218-223）。
 * 5. 一轮里某个键在后面的步又出现（连不连续都算），只记一次 turn_repeat，不干预（:402-430）。
 *
 * 本例另加一条：交替检测（cycle.ts），默认开，`--kimi` 关掉。
 */

import { type BreakerConfig } from "./config.ts";
import { detectCycle, trimHistory } from "./cycle.ts";
import { callKey } from "./key.ts";
import { cycleReminder, handoffVeto, REMINDER_1, REMINDER_3, reminder2 } from "./reminders.ts";
import type { Action, BreakerEvent, HandoffPhase, SettledResult, ToolCall, ToolOutput } from "./types.ts";

export interface BreakerState {
	/** 上一步结束时，调用序列最后一个键和它连续出现的次数 */
	readonly lastKey: string | null;
	readonly streak: number;
	readonly handoff: HandoffPhase;
	/** 这一轮里的第几步 */
	readonly step: number;
	/** 键 → 最后出现在第几步。只用来记 turn_repeat */
	readonly seen: ReadonlyMap<string, number>;
	readonly turnRepeats: number;
	/** 本例新增：最近的调用键，给交替检测用 */
	readonly history: readonly string[];
	readonly cycleReminded: boolean;
}

export type CallKind = "execute" | "share" | "veto";

export interface PlannedCall {
	readonly call: ToolCall;
	readonly key: string;
	readonly kind: CallKind;
}

export interface StepPlan {
	readonly state: BreakerState;
	readonly calls: readonly PlannedCall[];
	readonly handoffStep: boolean;
	readonly events: readonly BreakerEvent[];
}

export interface SettledStep {
	readonly state: BreakerState;
	readonly results: readonly SettledResult[];
	/** 这一步之后要不要结束这一轮 */
	readonly stopTurn: boolean;
	readonly events: readonly BreakerEvent[];
}

/** 新的一轮：全部清零（:340-347） */
export function startTurn(): BreakerState {
	return { lastKey: null, streak: 0, handoff: "idle", step: 0, seen: new Map(), turnRepeats: 0, history: [], cycleReminded: false };
}

export function planStep(state: BreakerState, calls: readonly ToolCall[]): StepPlan {
	const step = state.step + 1;
	const handoff: HandoffPhase = state.handoff === "pending" ? "active" : state.handoff;
	if (handoff === "active") {
		const vetoed = calls.map((call) => ({ call, key: callKey(call), kind: "veto" as const }));
		return { state: { ...state, step, handoff }, calls: vetoed, handoffStep: true, events: [] };
	}

	const seen = new Map(state.seen);
	const firstInStep = new Set<string>();
	const planned: PlannedCall[] = [];
	const events: BreakerEvent[] = [];
	let turnRepeats = state.turnRepeats;
	for (const call of calls) {
		const key = callKey(call);
		if (firstInStep.has(key)) {
			planned.push({ call, key, kind: "share" });
			events.push({ kind: "dedup", id: call.id, tool: call.tool, dupType: "same_step" });
			continue;
		}
		firstInStep.add(key);
		const lastStep = seen.get(key);
		if (lastStep !== undefined && lastStep !== step) {
			turnRepeats += 1;
			events.push({ kind: "turn_repeat", id: call.id, tool: call.tool, count: turnRepeats });
		}
		seen.set(key, step);
		if (key === state.lastKey && state.streak > 0) events.push({ kind: "dedup", id: call.id, tool: call.tool, dupType: "cross_step" });
		planned.push({ call, key, kind: "execute" });
	}
	return { state: { ...state, step, handoff, seen, turnRepeats }, calls: planned, handoffStep: false, events };
}

export function settleStep(config: BreakerConfig, plan: StepPlan, outputs: ReadonlyMap<string, ToolOutput>): SettledStep {
	return plan.handoffStep ? settleHandoff(config, plan) : settleNormal(config, plan, outputs);
}

/** 交接步：有调用就全部否决并结束；只有文字就是正常收尾（:218-223、:380-388） */
function settleHandoff(config: BreakerConfig, plan: StepPlan): SettledStep {
	const text = handoffVeto(config.stopAt);
	const results = plan.calls.map(({ call }) => ({ id: call.id, text, isError: true, executed: false }));
	const outcome = results.length > 0 ? "vetoed" : "text";
	return { state: { ...plan.state, handoff: "done" }, results, stopTurn: true, events: [{ kind: "handoff", outcome }] };
}

function settleNormal(config: BreakerConfig, plan: StepPlan, outputs: ReadonlyMap<string, ToolOutput>): SettledStep {
	const keys = plan.calls.map((p) => p.key);
	const streaks = runningStreaks(plan.state.lastKey, plan.state.streak, keys);
	const events: BreakerEvent[] = [...plan.events];
	const byKey = new Map<string, SettledResult>();
	let forceStopped = false;
	const results = plan.calls.map((p, i): SettledResult => {
		if (p.kind === "share") {
			const original = byKey.get(p.key)!;
			return { ...original, id: p.call.id, executed: false };
		}
		const output = outputs.get(p.call.id) ?? { text: "", isError: false };
		const streak = streaks[i]!;
		const action = actionFor(config, streak);
		if (action === "stop") forceStopped = true;
		if (streak >= 2) events.push({ kind: "repeat", tool: p.call.tool, streak, action });
		const settled = { id: p.call.id, text: output.text + reminderFor(action, streak), isError: output.isError, executed: true };
		byKey.set(p.key, settled);
		return settled;
	});

	const last = streaks.length > 0 ? { lastKey: keys.at(-1)!, streak: streaks.at(-1)! } : { lastKey: plan.state.lastKey, streak: plan.state.streak };
	const cycled = applyCycle(config, plan.state, keys, results, forceStopped);
	const handoff: HandoffPhase = forceStopped && plan.state.handoff === "idle" ? "pending" : plan.state.handoff;
	return {
		state: { ...plan.state, ...last, handoff, history: cycled.history, cycleReminded: cycled.reminded },
		results: cycled.results,
		stopTurn: forceStopped,
		events: [...events, ...cycled.events],
	};
}

/** 第 i 个调用处的连续次数：从上一步留下的计数接着数 */
export function runningStreaks(lastKey: string | null, streak: number, keys: readonly string[]): readonly number[] {
	const out: number[] = [];
	let prev = lastKey;
	let n = streak;
	for (const key of keys) {
		n = key === prev ? n + 1 : 1;
		prev = key;
		out.push(n);
	}
	return out;
}

export function actionFor(config: BreakerConfig, streak: number): Action {
	if (streak >= config.stopAt) return "stop";
	if (streak >= config.remind3) return "r3";
	if (streak >= config.remind2) return "r2";
	if (streak >= config.remind1) return "r1";
	return "none";
}

function reminderFor(action: Action, streak: number): string {
	switch (action) {
		case "r1":
			return REMINDER_1;
		case "r2":
			return reminder2(streak);
		case "r3":
		case "stop":
			return REMINDER_3;
		case "none":
			return "";
	}
}

interface CycleOutcome {
	readonly history: readonly string[];
	readonly reminded: boolean;
	readonly results: readonly SettledResult[];
	readonly events: readonly BreakerEvent[];
}

/** 一段交替只提醒一次；交替断了再出现，再提醒。已经真停的这一步不再叠交替提醒 */
function applyCycle(config: BreakerConfig, state: BreakerState, keys: readonly string[], results: readonly SettledResult[], forceStopped: boolean): CycleOutcome {
	const { enabled, maxPeriod, repeats } = config.cycle;
	if (!enabled) return { history: state.history, reminded: false, results, events: [] };
	const history = trimHistory([...state.history, ...keys], maxPeriod, repeats);
	const cycle = detectCycle(history, maxPeriod, repeats);
	if (cycle === undefined) return { history, reminded: false, results, events: [] };
	if (state.cycleReminded || forceStopped || results.length === 0) return { history, reminded: true, results, events: [] };
	const lastIndex = results.length - 1;
	const reminded = results.map((r, i) => (i === lastIndex ? { ...r, text: r.text + cycleReminder(cycle.period, cycle.repeats) } : r));
	return { history, reminded: true, results: reminded, events: [{ kind: "cycle", period: cycle.period, repeats: cycle.repeats }] };
}

/** 交接还没开始，轨迹就结束了（kimi-code 的 onDrop，:396-398） */
export function dropHandoff(state: BreakerState): { readonly state: BreakerState; readonly events: readonly BreakerEvent[] } {
	if (state.handoff !== "pending") return { state, events: [] };
	return { state: { ...state, handoff: "done" }, events: [{ kind: "handoff", outcome: "dropped" }] };
}
