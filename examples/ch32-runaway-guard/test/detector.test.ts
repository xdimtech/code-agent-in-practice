import { strict as assert } from "node:assert";
import { test } from "node:test";

import { newDetectorState, observeStep, type DetectorState, type StepOutcome } from "../src/detector.ts";
import type { Step, ToolKind } from "../src/types.ts";
import { SECRET, step } from "./helpers.ts";

const kinds: Record<string, ToolKind> = { task_output: "polling", todo_write: "exempt" };
const kindOf = (tool: string): ToolKind => kinds[tool] ?? "detect";

/** threshold 传 null 表示 shadow（不给阈值）；默认参数会吞掉显式的 undefined */
function run(steps: readonly Step[], threshold: number | null = 3): { state: DetectorState; outcomes: StepOutcome[] } {
	let state = newDetectorState(SECRET);
	const outcomes: StepOutcome[] = [];
	for (const s of steps) {
		const outcome = observeStep(state, s, kindOf, threshold ?? undefined);
		outcomes.push(outcome);
		state = outcome.state;
	}
	return { state, outcomes };
}

const read = () => step("read", { path: "a.ts" }, "same");

test("连续相同的调用：第 2 步观测，第 3 步给出提醒候选，之后不再给", () => {
	const { outcomes, state } = run([read(), read(), read(), read()]);
	assert.deepEqual(outcomes.map((o) => o.observations.map((x) => x.signal)), [[], ["action_repeat", "result_repeat"], [], []]);
	assert.deepEqual(outcomes.map((o) => [...o.candidates]), [[], [], ["action_repeat"], []]);
	assert.equal(state.maxOccurrences.action_repeat, 4);
});

test("连击是连续的：中间夹一步别的，计数清零", () => {
	const { outcomes } = run([read(), read(), step("ls", { path: "." }), read(), read()]);
	assert.ok(outcomes.every((o) => o.candidates.size === 0));
});

test("observeStep 不修改旧状态", () => {
	const before = newDetectorState(SECRET);
	const snapshot = { step: before.step, action: [...before.action], max: { ...before.maxOccurrences } };
	observeStep(before, read(), kindOf, 3);
	assert.deepEqual({ step: before.step, action: [...before.action], max: { ...before.maxOccurrences } }, snapshot);
});

test("threshold 为 undefined（shadow）：照样观测，不给候选", () => {
	const { outcomes, state } = run([read(), read(), read()], null);
	assert.ok(outcomes.every((o) => o.candidates.size === 0));
	assert.equal(state.maxOccurrences.action_repeat, 3);
});

test("轮询：同一问题同一回答才算；回答变了就清零", () => {
	const poll = (answer: string) => step("task_output", { id: "job" }, answer);
	const same = run([poll("running"), poll("running"), poll("running")]);
	assert.deepEqual([...same.outcomes[2]!.candidates], ["polling_repeat"]);
	assert.equal(same.state.maxOccurrences.action_repeat, 0);
	const changing = run([poll("10%"), poll("40%"), poll("80%")]);
	assert.ok(changing.outcomes.every((o) => o.candidates.size === 0));
});

test("exempt 工具不进任何计数", () => {
	const todo = () => step("todo_write", { items: [] });
	const { state } = run([todo(), todo(), todo()]);
	assert.deepEqual(Object.values(state.maxOccurrences), [0, 0, 0, 0, 0, 0]);
});

test("错误族：同一动作、措辞不同的同类错误也连起来", () => {
	const curl = (text: string) => step("bash", { command: "curl x" }, text, { isError: true });
	const { outcomes } = run([curl("timed out"), curl("deadline exceeded"), curl("timeout after 5s")]);
	assert.deepEqual([...outcomes[2]!.candidates].sort(), ["action_repeat", "error_family"]);
});

test("错误族：grep 没找到不算错误", () => {
	const grep = () => step("bash", { command: "grep -rn needle src" }, "command exited with code 1", { isError: true });
	const { state } = run([grep(), grep(), grep()]);
	assert.equal(state.maxOccurrences.error_family, 0);
	assert.equal(state.maxOccurrences.action_repeat, 3);
});

test("无进展：参数每次都变，但同一目标的状态不变", () => {
	const attempt = (i: number): Step => ({ ...step("edit", { file: "a.ts", patch: `try ${i}` }), progress: [{ target: "npm test", state: "1 failing" }] });
	const { outcomes, state } = run([attempt(1), attempt(2), attempt(3)]);
	assert.deepEqual([...outcomes[2]!.candidates], ["no_progress"]);
	assert.equal(state.maxOccurrences.action_repeat, 1);
});

test("无进展：状态变了就从 1 重新数", () => {
	const attempt = (s: string): Step => ({ ...step("edit", { s }), progress: [{ target: "npm test", state: s }] });
	const { state } = run([attempt("3 failing"), attempt("3 failing"), attempt("2 failing"), attempt("2 failing")]);
	assert.equal(state.progress.get("npm test")!.occurrences, 2);
});

test("ABAB：一段交替只观测一次（窗口滑成 BABA 也是同一段）", () => {
	const a = () => step("read", { path: "a.ts" });
	const b = () => step("read", { path: "b.ts" });
	const { outcomes } = run([a(), b(), a(), b(), a(), b()]);
	const abab = outcomes.flatMap((o) => o.observations.filter((x) => x.signal === "abab").map((x) => x.step));
	assert.deepEqual(abab, [4]);
	assert.ok(outcomes.every((o) => o.candidates.size === 0));
});

test("指纹算不出来的调用计入 skipped，不进连击", () => {
	const huge = () => step("write", { content: "x".repeat(20_000) });
	const { state } = run([huge(), huge(), huge()]);
	assert.equal(state.skipped, 3);
	assert.equal(state.maxOccurrences.action_repeat, 0);
});
