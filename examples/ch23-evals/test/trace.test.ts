import { strict as assert } from "node:assert";
import { test } from "node:test";

import { stripRoot } from "../src/root.ts";
import { TRACE_OPTIONS, normalizeEvents, normalizeValue } from "../src/trace.ts";
import type { AgentEvent } from "../src/types.ts";

test("归一化抹掉易变字段，但保留字段本身", () => {
	const normalized = normalizeValue({ sessionId: "s_9f3", toolCallId: "call_1", name: "read_file" });
	assert.deepEqual(Object.keys(normalized as object).sort(), ["name", "sessionId", "toolCallId"]);
	assert.equal((normalized as Record<string, unknown>).sessionId, "<volatile>");
	assert.equal((normalized as Record<string, unknown>).toolCallId, "<volatile>");
	assert.equal((normalized as Record<string, unknown>).name, "read_file");
});

test("易变字段认大小写和下划线：session_id 和 sessionId 一样处理", () => {
	for (const key of ["session_id", "SESSION-ID", "sessionID"]) {
		assert.equal((normalizeValue({ [key]: "x" }) as Record<string, unknown>)[key], "<volatile>", key);
	}
});

test("对象按键排序，比较结果不受书写顺序影响", () => {
	const left = normalizeValue({ b: 1, a: { d: 2, c: 3 } });
	const right = normalizeValue({ a: { c: 3, d: 2 }, b: 1 });
	assert.equal(JSON.stringify(left), JSON.stringify(right));
});

test("数组顺序保留：顺序本身就是信号", () => {
	assert.notEqual(JSON.stringify(normalizeValue([1, 2])), JSON.stringify(normalizeValue([2, 1])));
});

test("字符串按长度截断，并标出截掉了多少", () => {
	const normalized = normalizeValue("x".repeat(100), { maxStringLength: 10 }) as string;
	assert.ok(normalized.startsWith("x".repeat(10)));
	assert.ok(normalized.includes("90"));
});

test("没有配置根目录时，绝对路径原样留下——只有调用方才知道哪个前缀该抹", () => {
	assert.equal(normalizeValue("/tmp/ch23-eval-abc/work/a.txt"), "/tmp/ch23-eval-abc/work/a.txt");
});

test("配置了根目录，posix 和反斜杠两种写法都抹掉", () => {
	const options = { ...TRACE_OPTIONS, root: "/tmp/ch23-eval-abc" };
	assert.equal(normalizeValue("/tmp/ch23-eval-abc/work/a.txt", options), "<root>/work/a.txt");
	assert.equal(normalizeValue("C:\\tmp\\ch23-eval-abc\\work\\a.txt", { ...options, root: "C:\\tmp\\ch23-eval-abc" }), "<root>\\work\\a.txt");
});

test("stripRoot 只换前缀，不碰碰巧相同的中间片段", () => {
	assert.equal(stripRoot("/tmp/abc/x/tmp/abc/y", "/tmp/abc"), "<root>/x/tmp/abc/y");
});

test("非有限数写成占位符：NaN 经过 JSON 会变成 null，那就分不出「没有」和「算坏了」", () => {
	assert.equal(normalizeValue(Number.NaN), "<nonfinite>");
	assert.equal(normalizeValue(Number.POSITIVE_INFINITY), "<nonfinite>");
	assert.equal(normalizeValue(1.5), 1.5);
});

test("非普通对象只留类型名，不留一堆内部字段", () => {
	assert.equal(normalizeValue(new Date(0)), "<Date>");
	assert.equal(normalizeValue(new Map()), "<Map>");
});

test("undefined 也不崩：上游声称是 JSON，实际塞了个 undefined 进来", () => {
	assert.equal(normalizeValue(undefined), "<undefined>");
	assert.deepEqual(normalizeValue({ path: "a.txt", extra: undefined }), { extra: "<undefined>", path: "a.txt" });
});

test("事件流归一化后形状不变，时间戳全被抹平", () => {
	const events: AgentEvent[] = [
		{ type: "prompt", content: "hi" },
		{ type: "tool_call", name: "write_file", args: { path: "a.txt", timestamp: 1234 } },
		{ type: "tool_result", name: "write_file", result: { ok: true } },
		{ type: "response", content: "done" },
	];
	const normalized = normalizeEvents(events) as AgentEvent[];
	assert.deepEqual(
		normalized.map((event) => event.type),
		["prompt", "tool_call", "tool_result", "response"],
	);
	const call = normalized[1];
	assert.equal(call.type, "tool_call");
	// 归一化顺手把键排了序：两份轨迹拿去 diff 时，键的先后不该算差异
	assert.equal(JSON.stringify(call), JSON.stringify({ args: { path: "a.txt", timestamp: "<volatile>" }, name: "write_file", type: "tool_call" }));
});
