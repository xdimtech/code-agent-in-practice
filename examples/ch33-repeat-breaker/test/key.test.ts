import { strict as assert } from "node:assert";
import { test } from "node:test";

import { callKey, canonical, parseArguments } from "../src/key.ts";

test("canonical：对象键排序，数组顺序保留", () => {
	assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
	assert.equal(canonical([2, 1]), "[2,1]");
	assert.equal(canonical(undefined), "undefined");
});

test("callKey：键顺序不同的参数是同一个键，工具名不同就不是", () => {
	const a = callKey({ id: "1", tool: "Read", args: { path: "a", limit: 10 } });
	const b = callKey({ id: "2", tool: "Read", args: { limit: 10, path: "a" } });
	const c = callKey({ id: "3", tool: "Grep", args: { path: "a", limit: 10 } });
	assert.equal(a, b);
	assert.notEqual(a, c);
});

test("parseArguments：原文能解析就解析，空原文当 {}，坏原文标记失败", () => {
	assert.deepEqual(parseArguments({ id: "1", tool: "X", arguments: '{"a":1}' }), { args: { a: 1 }, parseFailed: false });
	assert.deepEqual(parseArguments({ id: "1", tool: "X", arguments: "" }), { args: {}, parseFailed: false });
	assert.deepEqual(parseArguments({ id: "1", tool: "X" }), { args: {}, parseFailed: false });
	assert.deepEqual(parseArguments({ id: "1", tool: "X", arguments: '{"a":' }), { args: {}, parseFailed: true });
});

test("callKey：解析失败用原文做键，截断位置不同的两次调用不会撞成 {}", () => {
	const x = callKey({ id: "1", tool: "Write", arguments: '{"path":"a.ts","con' });
	const y = callKey({ id: "2", tool: "Write", arguments: '{"path":"a.ts","content":"ab' });
	const empty = callKey({ id: "3", tool: "Write", args: {} });
	assert.notEqual(x, y);
	assert.notEqual(x, empty);
	assert.equal(x, callKey({ id: "4", tool: "Write", arguments: '{"path":"a.ts","con' }));
});

test("callKey：已解析的 args 优先于原文", () => {
	assert.equal(callKey({ id: "1", tool: "X", args: { a: 1 }, arguments: "garbage" }), callKey({ id: "2", tool: "X", args: { a: 1 } }));
});
