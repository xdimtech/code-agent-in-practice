/** 测试共用的小工具：造调用、造步、把一串步喂给断路器 */

import { planStep, settleStep, startTurn, type BreakerState, type SettledStep } from "../src/breaker.ts";
import { DEFAULT_CONFIG, type BreakerConfig } from "../src/config.ts";
import type { Step } from "../src/turn.ts";
import type { ToolCall, ToolOutput } from "../src/types.ts";

export const KIMI: BreakerConfig = { ...DEFAULT_CONFIG, cycle: { ...DEFAULT_CONFIG.cycle, enabled: false } };

let next = 0;

export function call(tool: string, args: unknown): ToolCall {
	return { id: `t${++next}`, tool, args };
}

export function rawCall(tool: string, raw: string): ToolCall {
	return { id: `t${++next}`, tool, arguments: raw };
}

export function read(path = "a.ts"): ToolCall {
	return call("Read", { path });
}

/** 每个调用都输出 text */
export function outputs(calls: readonly ToolCall[], text = "ok"): ReadonlyMap<string, ToolOutput> {
	return new Map(calls.map((c) => [c.id, { text, isError: false }]));
}

export function step(...calls: readonly ToolCall[]): Step {
	return { calls, outputs: outputs(calls) };
}

export const TEXT: Step = { calls: [], outputs: new Map() };

/** 直接跑一步：plan + settle */
export function runStep(config: BreakerConfig, state: BreakerState, calls: readonly ToolCall[], text = "ok"): SettledStep {
	return settleStep(config, planStep(state, calls), outputs(calls, text));
}

/** 连跑 n 步同一个调用（每步新 id），返回每一步的结果 */
export function repeatSteps(config: BreakerConfig, n: number, make: () => ToolCall, from: BreakerState = startTurn()): readonly SettledStep[] {
	const out: SettledStep[] = [];
	let state = from;
	for (let i = 0; i < n; i++) {
		const settled = runStep(config, state, [make()]);
		out.push(settled);
		state = settled.state;
	}
	return out;
}
