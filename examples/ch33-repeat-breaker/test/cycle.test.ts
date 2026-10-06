import { strict as assert } from "node:assert";
import { test } from "node:test";

import { detectCycle, trimHistory } from "../src/cycle.ts";

test("detectCycle：A B 交替三遍算打转", () => {
	assert.deepEqual(detectCycle(["A", "B", "A", "B", "A", "B"], 3, 3), { period: 2, repeats: 3 });
	assert.equal(detectCycle(["A", "B", "A", "B", "A"], 3, 3), undefined);
});

test("detectCycle：连续同一个键不归它管（那是主计数的事）", () => {
	assert.equal(detectCycle(["A", "A", "A", "A", "A", "A"], 3, 3), undefined);
});

test("detectCycle：三个一组也能认出来", () => {
	assert.deepEqual(detectCycle(["A", "B", "C", "A", "B", "C", "A", "B", "C"], 3, 3), { period: 3, repeats: 3 });
	assert.deepEqual(detectCycle(["A", "A", "B", "A", "A", "B", "A", "A", "B"], 3, 3), { period: 3, repeats: 3 });
});

test("detectCycle：只看尾巴，前面的杂项不影响", () => {
	assert.deepEqual(detectCycle(["X", "Y", "Z", "A", "B", "A", "B", "A", "B"], 3, 3), { period: 2, repeats: 3 });
	assert.equal(detectCycle(["A", "B", "A", "B", "A", "B", "C"], 3, 3), undefined);
});

test("detectCycle：超出 maxPeriod 的周期不认", () => {
	assert.equal(detectCycle(["A", "B", "C", "D", "A", "B", "C", "D", "A", "B", "C", "D"], 3, 3), undefined);
});

test("trimHistory：只留检测需要的尾巴，且不改原数组", () => {
	const keys = Array.from({ length: 30 }, (_, i) => String(i));
	const trimmed = trimHistory(keys, 3, 3);
	assert.equal(trimmed.length, 12);
	assert.equal(trimmed[0], "18");
	assert.equal(keys.length, 30);
	assert.equal(trimHistory(["A"], 3, 3).length, 1);
});
