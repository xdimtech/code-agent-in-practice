import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
	deepEqual,
	errorsOf,
	expectNoErrors,
	expectOutputContains,
	expectShape,
	expectToolArgs,
	expectToolArgsMatch,
	expectToolSequence,
	failedToolResults,
	failuresOf,
	formatFailures,
	toolCalls,
} from "../src/assertions.ts";
import type { AgentEvent, RunResult } from "../src/types.ts";

const events: AgentEvent[] = [
	{ type: "prompt", content: "改一下 package.json" },
	{ type: "tool_call", name: "read_file", args: { path: "package.json" } },
	{ type: "tool_result", name: "read_file", result: { ok: true } },
	{ type: "tool_call", name: "write_file", args: { path: "package.json", content: "{}" } },
	{ type: "tool_result", name: "write_file", result: { ok: true } },
	{ type: "response", content: "改好了" },
];

const result: RunResult = { output: "改好了", events, usage: { provider: "scripted", model: "x" }, artifacts: {} };

test("deepEqual 不看键顺序", () => {
	assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});

test("deepEqual 看数组顺序", () => {
	assert.equal(deepEqual([1, 2], [2, 1]), false);
	assert.equal(deepEqual([1, [2, 3]], [1, [2, 3]]), true);
});

test("deepEqual 不把 0 和 false 当同一个东西", () => {
	assert.equal(deepEqual(0, false), false);
	assert.equal(deepEqual(null, false), false);
});

test("toolCalls 只挑出调用，带参数", () => {
	const calls = toolCalls(events);
	assert.equal(calls.length, 2);
	assert.equal(calls[1].name, "write_file");
	assert.deepEqual(calls[1].args, { path: "package.json", content: "{}" });
});

test("工具顺序一致就过", () => {
	assert.deepEqual(expectToolSequence(events, ["read_file", "write_file"]), []);
});

test("工具顺序不对时，把期望和实际都写进 failure", () => {
	const failures = expectToolSequence(events, ["write_file"]);
	assert.equal(failures.length, 1);
	assert.equal(failures[0].check, "tool-sequence");
	assert.ok(failures[0].detail.includes("read_file, write_file"));
});

test("少调一次也要报出来，不是「子序列就算过」", () => {
	assert.equal(expectToolSequence([events[1]], ["read_file", "write_file"]).length, 1);
});

test("按序号查参数：写法不同也算不一样", () => {
	assert.deepEqual(expectToolArgs(events, 1, { path: "package.json", content: "{}" }), []);
	const swapped = expectToolArgs(events, 1, { content: "{}", path: "package.json" });
	assert.deepEqual(swapped, []);
	const wrong = expectToolArgs(events, 1, { path: "other.json", content: "{}" });
	assert.equal(wrong.length, 1);
	assert.ok(wrong[0].detail.includes("other.json"));
});

test("序号越界时给的是「没有第 n 次」，不是一句空 failure", () => {
	const failures = expectToolArgs(events, 5, {});
	assert.equal(failures.length, 1);
	assert.ok(failures[0].detail.includes("一共 2 次"));
});

test("形状断言用来处理天然带随机的参数", () => {
	const withTemp: AgentEvent[] = [{ type: "tool_call", name: "write_file", args: { path: "/tmp/abc/a.txt", content: "x" } }];
	assert.deepEqual(
		expectToolArgsMatch(withTemp, 0, {
			path: (value) => typeof value === "string" && value.endsWith("/a.txt"),
			content: (value) => value === "x",
		}),
		[],
	);
	const failures = expectToolArgsMatch(withTemp, 0, { path: (value) => value === "/fixed/a.txt" });
	assert.equal(failures.length, 1);
	assert.equal(failures[0].check, "tool-args-match[0].path");
});

test("没有 error 事件、工具也没失败，才算干净", () => {
	assert.deepEqual(expectNoErrors(events), []);
	const bad: AgentEvent[] = [...events, { type: "error", message: "工具炸了" }];
	assert.equal(expectNoErrors(bad).length, 1);
});

test("工具结果里的失败也要算进「不干净」，不能只看 error 事件", () => {
	const failed: AgentEvent[] = [{ type: "tool_result", name: "write_file", result: { ok: false, error: "写不了" } }];
	assert.equal(failedToolResults(failed).length, 1);
	assert.equal(errorsOf(failed).length, 0);
	assert.equal(expectNoErrors(failed).length, 1);
});

test("输出包含断言读的是最后一条 response", () => {
	assert.deepEqual(expectOutputContains(result, "改好了"), []);
	const failures = expectOutputContains(result, "已完成");
	assert.equal(failures.length, 1);
	assert.ok(failures[0].detail.includes("已完成"));
});

test("形状断言只看类型和工具名，不看参数", () => {
	assert.deepEqual(expectShape(events, ["prompt", "tool_call:read_file", "tool_result:read_file", "tool_call:write_file", "tool_result:write_file", "response"]), []);
	const failures = expectShape(events, ["prompt", "tool_call:write_file"]);
	assert.equal(failures.length, 1);
	assert.ok(failures[0].detail.includes("tool_call:read_file"));
});

test("多个断言的结果能合起来报，不是抛第一个就停", () => {
	const combined = failuresOf(expectToolSequence(events, ["nope"]), expectOutputContains(result, "nope"), expectNoErrors(events));
	assert.equal(combined.length, 2);
	assert.ok(formatFailures(combined).includes("tool-sequence"));
	assert.ok(formatFailures(combined).includes("output"));
});

test("没有失败时拼出来的是空串", () => {
	assert.equal(formatFailures([]), "");
});
