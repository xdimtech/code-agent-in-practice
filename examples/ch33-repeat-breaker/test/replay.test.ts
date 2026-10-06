import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { intervened, parseTrajectory, replay, TrajectoryError } from "../src/replay.ts";
import { KIMI } from "./helpers.ts";

const HERE = resolve(fileURLToPath(import.meta.url), "../..");
const load = (name: string) => parseTrajectory(readFileSync(join(HERE, "fixtures", name), "utf8"));

test("parseTrajectory：坏一行整份拒绝，并报行号", () => {
	const good = '{"calls":[{"id":"a","tool":"Read","args":{}}]}';
	assert.throws(() => parseTrajectory(`${good}\n{oops`), /第 2 行不是合法的 JSON/);
	assert.throws(() => parseTrajectory("[]"), /第 1 行：每一行要是一个对象/);
	assert.throws(() => parseTrajectory('{"calls":[{"id":"a","tool":"Read"}]}'), /calls 要是/);
	assert.throws(() => parseTrajectory('{"calls":[{"id":"a","tool":"Read","args":{},"arguments":"{}"}]}'), /calls 要是/);
	assert.throws(() => parseTrajectory('{"calls":[{"id":"a","tool":"Read","arguments":{}}]}'), /calls 要是/);
	assert.throws(() => parseTrajectory('{"calls":[{"id":"a","tool":"R","args":1},{"id":"a","tool":"R","args":1}]}'), /重复的 id/);
	assert.throws(() => parseTrajectory('{"calls":[],"results":[{"id":"x","text":"","isError":false}]}'), /找不到对应的 call/);
	assert.throws(() => parseTrajectory('{"calls":[],"results":[{"id":"x"}]}'), /results 要是/);
	assert.throws(() => parseTrajectory("\n\n"), TrajectoryError);
});

test("parseTrajectory：空行跳过，结果按 id 对上", () => {
	const steps = parseTrajectory('\n{"calls":[{"id":"a","tool":"Read","args":{}}],"results":[{"id":"a","text":"hi","isError":true}]}\n');
	assert.equal(steps.length, 1);
	assert.deepEqual(steps[0]!.outputs.get("a"), { text: "hi", isError: true });
});

test("replay：loop-read 的汇总", () => {
	const { summary } = replay(KIMI, load("loop-read.jsonl"));
	assert.deepEqual(summary, { turns: 1, steps: 13, executed: 12, shared: 0, vetoed: 0, reminders: { r1: 2, r2: 3, r3: 4 }, stops: 1, cycles: 0, turnRepeats: 11 });
	assert.equal(intervened(summary), true);
});

test("replay：same-step 共享两次，第 2 步就是第 4 次", () => {
	const { summary } = replay(KIMI, load("same-step.jsonl"));
	assert.equal(summary.shared, 2);
	assert.equal(summary.executed, 2);
	assert.deepEqual(summary.reminders, { r1: 1, r2: 0, r3: 0 });
});

test("replay：截断在不同位置的四次写入不会被当成重复", () => {
	const { summary } = replay(KIMI, load("truncated.jsonl"));
	assert.equal(intervened(summary), false);
	assert.equal(summary.turnRepeats, 0);
});

test("replay：交替的两份轨迹，kimi 原版不干预，本例干预", () => {
	for (const name of ["abab.jsonl", "parallel-pair.jsonl"]) {
		assert.equal(intervened(replay(KIMI, load(name)).summary), false, name);
		assert.equal(replay(DEFAULT_CONFIG, load(name)).summary.cycles, 1, name);
	}
});

test("replay：正常的一段会话不干预", () => {
	const { summary } = replay(DEFAULT_CONFIG, load("healthy.jsonl"));
	assert.equal(intervened(summary), false);
	assert.equal(summary.turnRepeats, 1);
});
