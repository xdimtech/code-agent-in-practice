import { strict as assert } from "node:assert";
import { test } from "node:test";

import { runSteps } from "../src/turn.ts";
import { KIMI, read, step, TEXT } from "./helpers.ts";

const repeatRead = (n: number) => Array.from({ length: n }, () => step(read()));

test("只写字的一步结束这一轮；下一轮的连续计数从零开始", () => {
	const run = runSteps(KIMI, [...repeatRead(4), TEXT, ...repeatRead(2), TEXT]);
	assert.deepEqual(run.turns.map((t) => [t.turn, t.steps, t.end]), [[1, 5, "text"], [2, 3, "text"]]);
	const second = run.steps.filter((s) => s.turn === 2);
	assert.ok(second.every((s) => s.events.every((e) => e.kind !== "repeat" || e.action === "none")));
});

test("真停之后的一步是交接，仍属于同一轮", () => {
	const run = runSteps(KIMI, [...repeatRead(12), TEXT, step(read())]);
	assert.deepEqual(run.turns.map((t) => [t.turn, t.steps, t.end]), [[1, 13, "repeat_breaker"], [2, 1, "incomplete"]]);
	assert.equal(run.steps[12]!.handoff, true);
});

test("交接步里调了工具：否决并结束这一轮", () => {
	const run = runSteps(KIMI, [...repeatRead(12), step(read())]);
	assert.equal(run.turns[0]!.end, "repeat_breaker");
	assert.equal(run.steps[12]!.results[0]!.executed, false);
});

test("步数上限：超过上限的一步不再开始，这一轮以 max_steps 结束，下一步进新的一轮", () => {
	const run = runSteps({ ...KIMI, maxSteps: 5 }, [...repeatRead(7), TEXT]);
	assert.deepEqual(run.turns.map((t) => [t.steps, t.end]), [[5, "max_steps"], [3, "text"]]);
	assert.equal(run.steps[5]!.turn, 2);
	assert.equal(run.steps[5]!.step, 1);
});

test("交接步绕过步数上限", () => {
	const run = runSteps({ ...KIMI, maxSteps: 12 }, [...repeatRead(12), TEXT]);
	assert.deepEqual(run.turns.map((t) => [t.steps, t.end]), [[13, "repeat_breaker"]]);
	assert.ok(run.steps[12]!.events.some((e) => e.kind === "handoff" && e.outcome === "text"));
});

test("轨迹在交接之前结束：记为 incomplete，并标出交接被丢弃", () => {
	const run = runSteps(KIMI, repeatRead(12));
	assert.deepEqual(run.turns, [{ turn: 1, steps: 12, end: "incomplete", handoffDropped: true }]);
});

test("轨迹在一轮中间结束：incomplete，没有交接", () => {
	const run = runSteps(KIMI, repeatRead(3));
	assert.deepEqual(run.turns, [{ turn: 1, steps: 3, end: "incomplete", handoffDropped: false }]);
});
