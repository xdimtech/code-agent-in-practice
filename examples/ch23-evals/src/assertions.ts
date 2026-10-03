/**
 * 断言层：把「这次做对了没有」拆成能说清哪一条没过的函数。
 *
 * 这里不抛异常，只返回 Failure 列表。理由是这套东西的主要用途不是让 CI 变红，
 * 而是回答「候选方案和基线差在哪」——一个测试里可能同时记三条，抛第一个异常就
 * 把后面两条的信息丢了。要变红的时候由调用方统一决定（见 score.ts）。
 */

import { eventShape } from "./trace.ts";
import type { AgentEvent, JsonValue, RunResult, ToolResult } from "./types.ts";

export interface Failure {
	/** 哪一条断言 */
	readonly check: string;
	/** 具体差在哪 */
	readonly detail: string;
}

export function failuresOf(...checks: ReadonlyArray<readonly Failure[]>): Failure[] {
	return checks.flat();
}

/** 深比较，只认 JSON 值。对象键顺序不影响结果；数组顺序影响 */
export function deepEqual(left: JsonValue, right: JsonValue): boolean {
	if (left === right) return true;
	if (left === null || right === null) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((item, index) => deepEqual(item, right[index]));
	}
	if (typeof left !== "object" || typeof right !== "object") return false;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual((left as Record<string, JsonValue>)[key], (right as Record<string, JsonValue>)[key]));
}

export function toolCalls(events: readonly AgentEvent[]): Array<{ name: string; args: Record<string, JsonValue> }> {
	const calls: Array<{ name: string; args: Record<string, JsonValue> }> = [];
	for (const event of events) {
		if (event.type === "tool_call") calls.push({ name: event.name, args: event.args });
	}
	return calls;
}

export function errorsOf(events: readonly AgentEvent[]): string[] {
	return events.filter((event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error").map((event) => event.message);
}

export function failedToolResults(events: readonly AgentEvent[]): ToolResult[] {
	return events
		.filter((event): event is Extract<AgentEvent, { type: "tool_result" }> => event.type === "tool_result")
		.map((event) => event.result)
		.filter((result) => !result.ok);
}

/** 工具调用的顺序和名字必须完全一致。多调少调都要报出来 */
export function expectToolSequence(events: readonly AgentEvent[], expected: readonly string[]): Failure[] {
	const actual = toolCalls(events).map((call) => call.name);
	if (actual.length === expected.length && actual.every((name, index) => name === expected[index])) return [];
	return [
		{
			check: "tool-sequence",
			detail: `期望 [${expected.join(", ")}]，实际 [${actual.join(", ")}]`,
		},
	];
}

/**
 * 必须有这些工具，且按这个先后顺序出现，中间允许夹别的调用。
 *
 * 和 expectToolSequence 的分工值得说清：那个是「一模一样」，这个只认「该走的步骤没漏、顺序没反」。
 * 用哪个取决于你要测的是什么——要测「少一次探查就做不对」就用上面那个，
 * 要测「换个说法、多列一次目录，也不该算错」就得用这个。写死成上一种，
 * 会把「模型多看了一眼」判成失败，这种测试跑久了只会被人加白名单。
 */
export function expectToolOrder(events: readonly AgentEvent[], expected: readonly string[]): Failure[] {
	const actual = toolCalls(events).map((call) => call.name);
	let cursor = 0;
	for (const name of actual) {
		if (cursor < expected.length && name === expected[cursor]) cursor += 1;
	}
	if (cursor === expected.length) return [];
	return [
		{
			check: "tool-order",
			detail: `期望按顺序出现 [${expected.join(", ")}]，实际 [${actual.join(", ")}]`,
		},
	];
}

/** 第 n 次工具调用的参数（n 从 0 数起）必须和期望一致 */
export function expectToolArgs(
	events: readonly AgentEvent[],
	index: number,
	expected: Record<string, JsonValue>,
): Failure[] {
	const calls = toolCalls(events);
	const call = calls[index];
	if (!call) return [{ check: `tool-args[${index}]`, detail: `没有第 ${index} 次工具调用（一共 ${calls.length} 次）` }];
	if (deepEqual(call.args, expected)) return [];
	return [
		{
			check: `tool-args[${index}]`,
			detail: `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(call.args)}`,
		},
	];
}

/**
 * 工具的入参必须匹配给定的形状。值用函数写，因为有些参数天然带随机部分
 * （临时路径、时间戳），只能检查「像不像」。
 */
export function expectToolArgsMatch(
	events: readonly AgentEvent[],
	index: number,
	shape: Record<string, (value: JsonValue | undefined) => boolean>,
): Failure[] {
	const call = toolCalls(events)[index];
	if (!call) return [{ check: `tool-args-match[${index}]`, detail: `没有第 ${index} 次工具调用` }];
	const failures: Failure[] = [];
	for (const [key, predicate] of Object.entries(shape)) {
		if (!predicate(call.args[key])) {
			failures.push({ check: `tool-args-match[${index}].${key}`, detail: `参数 ${key}=${JSON.stringify(call.args[key])} 不满足条件` });
		}
	}
	return failures;
}

/** 全程不该有 error 事件，工具结果也都不该失败 */
export function expectNoErrors(events: readonly AgentEvent[]): Failure[] {
	const failures: Failure[] = [];
	for (const message of errorsOf(events)) failures.push({ check: "no-errors", detail: `出现 error 事件：${message}` });
	for (const result of failedToolResults(events)) {
		failures.push({ check: "no-errors", detail: `工具失败：${result.error ?? "没有给原因"}` });
	}
	return failures;
}

export function expectOutputContains(result: RunResult, expected: string): Failure[] {
	if (result.output.includes(expected)) return [];
	return [{ check: "output", detail: `输出里没有 ${JSON.stringify(expected)}：${JSON.stringify(result.output.slice(0, 120))}` }];
}

export function expectShape(events: readonly AgentEvent[], expected: readonly string[]): Failure[] {
	const actual = eventShape(events);
	if (actual.length === expected.length && actual.every((item, index) => item === expected[index])) return [];
	return [{ check: "event-shape", detail: `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}` }];
}

/** 把一组失败拼成一句能读的话，给 judge 的 rationale 用 */
export function formatFailures(failures: readonly Failure[]): string {
	return failures.map(({ check, detail }) => `${check}: ${detail}`).join("; ");
}
