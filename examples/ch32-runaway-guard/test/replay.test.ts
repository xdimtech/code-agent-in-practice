import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { parseTrajectory, replay, TrajectoryError } from "../src/replay.ts";
import { SECRET } from "./helpers.ts";

const FIXTURES = resolve(fileURLToPath(import.meta.url), "../../fixtures");
const load = (name: string) => parseTrajectory(readFileSync(resolve(FIXTURES, `${name}.jsonl`), "utf8"));
const reminded = (name: string) => replay(DEFAULT_CONFIG, load(name), SECRET).events.map((e) => (e.decision.kind === "remind" ? `${e.step}:${e.decision.signal}` : `${e.step}:stop`));

test("fixtures：每一份都在预期的那一步、以预期的信号提醒", () => {
	assert.deepEqual(reminded("loop-read"), ["3:action_repeat"]);
	assert.deepEqual(reminded("flaky-network"), ["3:error_family"]);
	assert.deepEqual(reminded("grep-no-match"), ["3:action_repeat"]);
	assert.deepEqual(reminded("no-progress"), ["3:no_progress"]);
	assert.deepEqual(reminded("poll"), ["3:polling_repeat"]);
	assert.deepEqual(reminded("mixed"), ["3:action_repeat"]);
	assert.deepEqual(reminded("abab"), []);
});

test("回放不在提醒处停：轨迹看完，后面的观测照记", () => {
	const report = replay(DEFAULT_CONFIG, load("mixed"), SECRET);
	assert.equal(report.summary.steps, 7);
	assert.ok(report.observations.some((o) => o.step === 5 && o.signal === "error_family"));
});

test("回放在 stop 处停", () => {
	const report = replay({ ...DEFAULT_CONFIG, maxSteps: 4 }, load("loop-read"), SECRET);
	assert.equal(report.summary.steps, 4);
	assert.deepEqual(report.events.at(-1)!.decision.kind, "stop");
});

test("同一份轨迹、同一把密钥，两次回放结果一样", () => {
	assert.deepEqual(replay(DEFAULT_CONFIG, load("mixed"), SECRET), replay(DEFAULT_CONFIG, load("mixed"), SECRET));
});

const bad: readonly [string, RegExp][] = [
	["", /空的/],
	["\n\n", /空的/],
	["{not json", /第 1 行不是合法的 JSON/],
	["[]", /第 1 行：每一行要是一个对象/],
	['{"calls":[],"results":[]}\n{"calls":[{"id":"a","tool":"read"}],"results":[]}', /第 2 行：calls/],
	['{"calls":[],"results":[{"id":"a","isError":"no","text":""}]}', /results/],
	['{"calls":[{"id":"a","tool":"x","args":1},{"id":"a","tool":"y","args":2}],"results":[]}', /重复的 id/],
	['{"calls":[],"results":[{"id":"z","isError":false,"text":""}]}', /结果 z 找不到对应的 call/],
	['{"calls":[],"results":[],"progress":[{"target":"","state":"x"}]}', /progress/],
];

for (const [text, message] of bad) {
	test(`parseTrajectory 拒绝：${JSON.stringify(text).slice(0, 40)}`, () => {
		assert.throws(() => parseTrajectory(text), (error: unknown) => error instanceof TrajectoryError && message.test(error.message));
	});
}
