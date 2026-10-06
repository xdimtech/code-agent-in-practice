import { strict as assert } from "node:assert";
import { test } from "node:test";

import { fingerprint, newSecret, stableStringify } from "../src/fingerprint.ts";
import { SECRET } from "./helpers.ts";

test("stableStringify：键的顺序不影响结果", () => {
	assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
});

test("stableStringify：不可序列化的值返回 undefined，而不是猜", () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.equal(stableStringify(cyclic), undefined);
	assert.equal(stableStringify({ n: Number.NaN }), undefined);
	assert.equal(stableStringify({ d: new Date(0) }), undefined);
	assert.equal(stableStringify({ f: () => 1 }), undefined);
	let deep: unknown = 0;
	for (let i = 0; i < 40; i++) deep = [deep];
	assert.equal(stableStringify(deep), undefined);
});

test("stableStringify：超过字节预算返回 undefined", () => {
	assert.equal(stableStringify("x".repeat(100), 50), undefined);
	assert.notEqual(stableStringify("x".repeat(10), 50), undefined);
});

test("stableStringify：同一个对象出现两次不算环", () => {
	const shared = { a: 1 };
	assert.equal(stableStringify([shared, shared]), '[{"a":1},{"a":1}]');
});

test("fingerprint：同密钥同值相同，不含原文", () => {
	const a = fingerprint(SECRET, { path: "src/secret-name.ts" });
	assert.equal(a, fingerprint(SECRET, { path: "src/secret-name.ts" }));
	assert.match(a!, /^[A-Za-z0-9_-]{43}$/);
	assert.ok(!a!.includes("secret-name"));
});

test("fingerprint：换一轮（换密钥）就对不上", () => {
	const value = { command: "npm test" };
	assert.notEqual(fingerprint(newSecret(), value), fingerprint(newSecret(), value));
});
