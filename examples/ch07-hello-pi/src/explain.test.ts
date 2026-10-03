import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { countByType, describeEvent, groupByTurn, parseNdjson, renderTimeline } from "./explain.ts";

const fixture = readFileSync(new URL("../fixtures/run-json.txt", import.meta.url), "utf8");

test("fixture 是 23 行，和真实跑出来的一次一致", () => {
	assert.equal(parseNdjson(fixture).length, 23);
});

test("坏行不抛错，留成一条记录", () => {
	const events = parseNdjson('{"type":"a"}\nnot json\n{"type":"b"}\n\n');
	assert.deepEqual(events.map((e) => e.type), ["a", "（不是 JSON）", "b"]);
});

test("不是对象的一行也留着", () => {
	assert.deepEqual(parseNdjson("[1,2]").map((e) => e.type), ["（不是对象）"]);
});

test("分组：头在轮 0，两次 turn_start 分两轮", () => {
	const timeline = groupByTurn(parseNdjson(fixture));
	assert.equal(timeline.header?.version, 3);
	const numbered = timeline.turns.filter((t) => t.turn > 0);
	assert.equal(numbered.length, 2);
	assert.equal(numbered[0].events[0].type, "turn_start");
	assert.equal(numbered[0].events.at(-1)?.type, "turn_end");
});

test("轮次之外的事件挂在轮 0", () => {
	const timeline = groupByTurn(parseNdjson(fixture));
	const zero = timeline.turns.filter((t) => t.turn === 0).flatMap((t) => t.events.map((e) => e.type));
	assert.ok(zero.includes("agent_start"));
	assert.ok(zero.includes("agent_settled"));
	assert.ok(!zero.includes("turn_start"));
});

test("事件类型：和真实事件表对得上", () => {
	const counts = countByType(parseNdjson(fixture));
	assert.deepEqual(
		[...counts].sort(),
		[
			["agent_end", 1],
			["agent_settled", 1],
			["agent_start", 1],
			["message_end", 4],
			["message_start", 4],
			["message_update", 5],
			["session", 1],
			["tool_execution_end", 1],
			["tool_execution_start", 1],
			["turn_end", 2],
			["turn_start", 2],
		].sort(),
	);
});

test("每句话都带上了关键信息", () => {
	const timeline = groupByTurn(parseNdjson(fixture));
	const lines = timeline.turns.flatMap((t) => t.events.map(describeEvent));
	assert.ok(lines.some((l) => l.includes("脚本模型") || l.includes("toolResult")));
	assert.ok(lines.some((l) => l === "开始执行工具 \"read\""));
	assert.ok(lines.some((l) => l.includes("工具 \"read\" 执行完")));
	assert.ok(lines.some((l) => l.includes("文本 +")));
	assert.ok(lines.some((l) => l.includes("stopReason=")));
});

test("渲染出来有轮次标题和总数", () => {
	const text = renderTimeline(groupByTurn(parseNdjson(fixture)));
	assert.match(text, /\[第 1 轮\]/);
	assert.match(text, /\[第 2 轮\]/);
	assert.match(text, /共 23 个事件，2 轮。/);
});

test("空输入不炸", () => {
	const timeline = groupByTurn(parseNdjson(""));
	assert.equal(timeline.total, 0);
	assert.equal(timeline.turns.length, 0);
	assert.match(renderTimeline(timeline), /共 0 个事件/);
});
