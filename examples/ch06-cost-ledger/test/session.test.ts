import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseSession, readLine, readUsage } from "../src/session.ts";

const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 } };
const assistant = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({ type: "message", id: "a1", message: { role: "assistant", provider: "anthropic", model: "m", timestamp: 1000, usage, ...extra } });

test("readUsage：字段缺了、是负数、是 NaN 都给出原因，不返回数字", () => {
	assert.equal(typeof readUsage(usage), "object");
	assert.match(readUsage(null) as string, /不是对象/);
	assert.match(readUsage({ ...usage, cacheRead: -1 }) as string, /cacheRead/);
	assert.match(readUsage({ ...usage, cost: { ...usage.cost, total: "1" } }) as string, /cost\.total/);
	assert.match(readUsage({ ...usage, cacheWrite1h: -5 }) as string, /cacheWrite1h/);
});

test("readUsage：没给 totalTokens 时自己加；给了 cacheWrite1h 原样留下", () => {
	const { totalTokens: _t, ...rest } = usage;
	const u = readUsage({ ...rest, cacheWrite1h: 2 });
	assert.ok(typeof u === "object");
	assert.equal(u.totalTokens, 10);
	assert.equal(u.cacheWrite1h, 2);
});

test("readLine：只认 assistant、compaction、branch_summary；其余行忽略", () => {
	assert.equal(readLine(JSON.stringify({ type: "session", id: "s" })), undefined);
	assert.equal(readLine(JSON.stringify({ type: "message", message: { role: "user" } })), undefined);
	const a = readLine(assistant());
	assert.ok(typeof a === "object" && a.kind === "assistant");
	assert.equal(a.turn.timestamp, 1000);
	const c = readLine(JSON.stringify({ type: "compaction", id: "c", tokensBefore: 5, usage }));
	assert.ok(typeof c === "object" && c.kind === "compaction" && c.usage?.cost.total === 1);
	const b = readLine(JSON.stringify({ type: "branch_summary", id: "b" }));
	assert.deepEqual(b, { kind: "branch_summary", id: "b" });
});

test("readLine：坏行返回原因", () => {
	assert.equal(readLine("{oops"), "不是合法 JSON");
	assert.equal(readLine("[1]"), "不是 JSON 对象");
	assert.match(readLine(assistant({ provider: 1 })) as string, /provider/);
	assert.match(readLine(assistant({ timestamp: "x" })) as string, /timestamp/);
	assert.match(readLine(JSON.stringify({ type: "compaction", id: "c" })) as string, /tokensBefore/);
});

test("parseSession：坏行记行号跳过，好行照收，空行不算问题", () => {
	const r = parseSession([assistant(), "", "{oops", assistant()].join("\n"));
	assert.equal(r.entries.length, 2);
	assert.deepEqual(r.problems, ["第 3 行：不是合法 JSON"]);
});
