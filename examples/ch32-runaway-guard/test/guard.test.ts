import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DEFAULT_CONFIG, type GuardConfig } from "../src/config.ts";
import { decide, guardStep, pickSignal, startTurn, summarize, type TurnState } from "../src/guard.ts";
import { NOT_A_RULE } from "../src/reminder.ts";
import type { Decision, Step } from "../src/types.ts";
import { SECRET, step } from "./helpers.ts";

const read = () => step("read", { path: "a.ts" }, "same");

function drive(config: GuardConfig, steps: readonly Step[], steer: (content: string) => void = () => {}): { turn: TurnState; decisions: Decision[] } {
	let turn = startTurn(SECRET);
	const decisions: Decision[] = [];
	for (const s of steps) {
		const result = guardStep(config, turn, s, steer);
		turn = result.turn;
		decisions.push(result.decision);
	}
	return { turn, decisions };
}

test("一轮最多提醒一次：第 3 步提醒，之后同一信号再越线也不提醒", () => {
	const { decisions, turn } = drive(DEFAULT_CONFIG, [read(), read(), read(), read(), read(), read()]);
	assert.deepEqual(decisions.map((d) => d.kind), ["continue", "continue", "remind", "continue", "continue", "continue"]);
	assert.equal(turn.reminderInjected, true);
});

test("一轮最多一次：换一种信号越线也不再提醒", () => {
	const curl = () => step("bash", { command: "curl x" }, "timed out", { isError: true });
	const { decisions } = drive(DEFAULT_CONFIG, [read(), read(), read(), curl(), curl(), curl()]);
	assert.equal(decisions.filter((d) => d.kind === "remind").length, 1);
});

test("提醒文案带「不要写进记忆」那句", () => {
	const { decisions } = drive(DEFAULT_CONFIG, [read(), read(), read()]);
	const remind = decisions[2]!;
	assert.equal(remind.kind, "remind");
	assert.ok(remind.kind === "remind" && remind.content.endsWith(NOT_A_RULE));
});

test("pickSignal：多个候选按优先级选", () => {
	assert.equal(pickSignal(new Set(["action_repeat", "error_family"])), "error_family");
	assert.equal(pickSignal(new Set(["polling_repeat", "no_progress", "action_repeat"])), "no_progress");
	assert.equal(pickSignal(new Set()), undefined);
});

test("同一步同时越线：错误族压过重复调用", () => {
	const curl = () => step("bash", { command: "curl x" }, "timed out", { isError: true });
	const { decisions } = drive(DEFAULT_CONFIG, [curl(), curl(), curl()]);
	assert.deepEqual(decisions[2], decisions[2]!.kind === "remind" ? { ...decisions[2], signal: "error_family" } : undefined);
});

test("先占位再 steer：steer 抛错，这一轮继续，failures 记 1，之后不重试", () => {
	let calls = 0;
	const { decisions, turn } = drive(DEFAULT_CONFIG, [read(), read(), read(), read()], () => {
		calls++;
		throw new Error("queue closed");
	});
	assert.equal(calls, 1);
	assert.deepEqual(decisions.map((d) => d.kind), ["continue", "continue", "remind", "continue"]);
	assert.deepEqual({ attempted: turn.reminderAttempted, injected: turn.reminderInjected, failures: turn.failures }, { attempted: true, injected: false, failures: 1 });
});

test("decide 本身已经占位：不经过 steer，状态里也记着「已尝试」", () => {
	let turn = startTurn(SECRET);
	for (const s of [read(), read()]) turn = decide(DEFAULT_CONFIG, turn, s).turn;
	const before = turn;
	const result = decide(DEFAULT_CONFIG, turn, read());
	assert.equal(result.turn.reminderAttempted, true);
	assert.equal(before.reminderAttempted, false, "旧状态不被修改");
});

test("检测抛错：放行并记账", () => {
	const broken = { calls: null, results: [] } as unknown as Step;
	const { decisions, turn } = drive(DEFAULT_CONFIG, [broken]);
	assert.deepEqual(decisions, [{ kind: "continue" }]);
	assert.equal(turn.failures, 1);
});

test("shadow：只观测，从不提醒", () => {
	const { decisions, turn } = drive({ ...DEFAULT_CONFIG, shadow: true }, [read(), read(), read(), read()]);
	assert.ok(decisions.every((d) => d.kind === "continue"));
	assert.equal(turn.detector.maxOccurrences.action_repeat, 4);
});

test("关闭：清空连击，重新打开后从零数", () => {
	const off = { ...DEFAULT_CONFIG, enabled: false };
	let turn = startTurn(SECRET);
	for (const s of [read(), read()]) turn = guardStep(DEFAULT_CONFIG, turn, s, () => {}).turn;
	turn = guardStep(off, turn, read(), () => {}).turn;
	assert.equal(turn.detector.step, 3, "步数照数");
	const resumed = guardStep(DEFAULT_CONFIG, turn, read(), () => {});
	assert.equal(resumed.decision.kind, "continue", "关掉之前的两次不算");
});

test("maxSteps：到上限就停，这是唯一会停的路径", () => {
	const { decisions } = drive({ ...DEFAULT_CONFIG, maxSteps: 2 }, [step("a", 1), step("b", 2)]);
	assert.deepEqual(decisions.map((d) => d.kind), ["continue", "stop"]);
});

test("summarize：只有计数，没有原文和指纹", () => {
	const { turn } = drive(DEFAULT_CONFIG, [read(), read(), read()]);
	const text = JSON.stringify(summarize(turn));
	assert.ok(!text.includes("a.ts") && !text.includes("same"));
	assert.deepEqual(Object.keys(summarize(turn)).sort(), ["failures", "maxOccurrences", "reminderAttempted", "reminderInjected", "skippedFingerprints", "steps"]);
});
