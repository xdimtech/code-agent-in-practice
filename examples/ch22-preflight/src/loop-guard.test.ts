import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, fingerprint, initialState, onToolCall, onTurnEnd, stableStringify, validateLimits, type GuardState } from "./loop-guard.ts";

const run = (calls: ReadonlyArray<readonly [string, unknown]>, limits = DEFAULT_LIMITS) => {
	let state: GuardState = initialState();
	return calls.map(([tool, input]) => {
		const step = onToolCall(state, limits, tool, input);
		state = step.state;
		return step.verdict;
	});
};

test("validateLimits：缺的项用默认值，坏值直接拒绝", () => {
	assert.deepEqual(validateLimits({}), DEFAULT_LIMITS);
	assert.deepEqual(validateLimits({ maxRepeats: 5 }), { maxTurns: 40, maxRepeats: 5 });
	for (const bad of [null, "3", { maxTurns: 0 }, { maxRepeats: 1.5 }, { maxTurns: "40" }, { maxRepeats: -1 }]) {
		assert.throws(() => validateLimits(bad), TypeError);
	}
});

test("stableStringify：键的顺序不影响结果，数组顺序影响", () => {
	assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
	assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
	assert.equal(stableStringify(undefined), "null");
});

test("fingerprint：工具名、参数、代数任何一项不同都不同；不含原文", () => {
	const base = fingerprint("bash", { command: "npm test" }, 0);
	assert.equal(base, fingerprint("bash", { command: "npm test" }, 0));
	assert.notEqual(base, fingerprint("bash", { command: "npm test" }, 1));
	assert.notEqual(base, fingerprint("read", { command: "npm test" }, 0));
	assert.notEqual(base, fingerprint("bash", { command: "npm run test" }, 0));
	assert.ok(!base.includes("npm"));
	assert.match(base, /^bash@0:[0-9a-f]{16}$/);
});

test("同一个调用第四次被拦，带 terminate 和理由", () => {
	const test4 = run(Array.from({ length: 4 }, () => ["bash", { command: "npm test" }] as const));
	assert.deepEqual(test4.slice(0, 3).map((v) => v.kind), ["allow", "allow", "allow"]);
	const last = test4[3];
	assert.equal(last?.kind, "block");
	if (last?.kind !== "block") return;
	assert.equal(last.terminate, true);
	assert.equal(last.count, 4);
	assert.match(last.reason, /第 4 次（上限 3）/);
});

test("edit / write 换代：改完再跑同样的测试不算重复", () => {
	const t = ["bash", { command: "npm test" }] as const;
	const e = ["edit", { path: "a.ts" }] as const;
	const w = ["write", { path: "b.ts", content: "x" }] as const;
	assert.ok(run([t, e, t, w, t, e, t, e, t]).every((v) => v.kind === "allow"));
});

test("用 bash 改文件不换代，照样数进去", () => {
	const t = ["bash", { command: "npm test" }] as const;
	const s = ["bash", { command: "sed -i s/a/b/ a.ts" }] as const;
	assert.equal(run([t, s, t, s, t, s, t]).at(-1)?.kind, "block");
});

test("参数顺序不同算同一个调用", () => {
	const verdicts = run([
		["grep", { pattern: "x", path: "." }],
		["grep", { path: ".", pattern: "x" }],
	]);
	assert.equal(verdicts[1]?.count, 2);
});

test("onToolCall 不改传入的状态", () => {
	const state = initialState();
	const frozen = Object.freeze({ ...state, counts: Object.freeze({}) });
	const step = onToolCall(frozen, DEFAULT_LIMITS, "edit", { path: "a" });
	assert.deepEqual(frozen, initialState());
	assert.equal(step.state.generation, 1);
	assert.notEqual(step.state, frozen);
});

test("onTurnEnd：到上限那一轮才停，不改传入状态", () => {
	const limits = { maxTurns: 3, maxRepeats: 3 };
	let state = initialState();
	const stops: boolean[] = [];
	for (let i = 0; i < 3; i++) {
		const before = state;
		const step = onTurnEnd(state, limits);
		assert.equal(before.turns, i);
		state = step.state;
		stops.push(step.stop);
	}
	assert.deepEqual(stops, [false, false, true]);
	assert.match(onTurnEnd({ ...state, turns: 2 }, limits).reason ?? "", /3 轮（上限 3）/);
});
