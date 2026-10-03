import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantDraft, eventsForTurn, runOneTurn } from "./stream.ts";
import type { Context, Message } from "./types.ts";

const model = { api: "scripted", provider: "scripted", id: "hello" };
const user: Message = { role: "user", content: [{ type: "text", text: "读一下" }] };
const toolResult: Message = {
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "read",
	content: [{ type: "text", text: "hello" }],
	isError: false,
};

test("第一轮的事件顺序：start → toolcall_start → toolcall_end → done", () => {
	const events = eventsForTurn(createAssistantDraft(model), { messages: [user] });
	assert.deepEqual(events.map((e) => e.type), ["start", "toolcall_start", "toolcall_end", "done"]);
	assert.equal(events.at(-1)?.type === "done" ? events.at(-1)?.reason : "", "toolUse");
});

test("toolcall_start 之前 content 已经填好 —— json-event 转换要靠这个", () => {
	// modes/json-event.ts:23-30 在 toolcall_start 时读 partial.content[contentIndex]，
	// 读不到工具调用会直接抛错。所以这里断言：事件返回时块已经在里面。
	const draft = createAssistantDraft(model);
	const events = eventsForTurn(draft, { messages: [user] });
	const start = events[1];
	assert.equal(start.type, "toolcall_start");
	assert.equal(draft.content.length, 1);
	const block = draft.content[0] as { type: string; name: string };
	assert.equal(block.type, "toolCall");
	assert.equal(block.name, "read");
});

test("第二轮的事件顺序：start → text_start → text_delta → text_end → done", () => {
	const events = eventsForTurn(createAssistantDraft(model), { messages: [user, toolResult] }, { report: false, file: "hello.txt" });
	assert.deepEqual(events.map((e) => e.type), ["start", "text_start", "text_delta", "text_end", "done"]);
	assert.equal(events.at(-1)?.type === "done" ? events.at(-1)?.reason : "", "stop");
});

test("delta 是增量，partial 里是全文", () => {
	const draft = createAssistantDraft(model);
	const events = eventsForTurn(draft, { messages: [user, toolResult] }, { report: false, file: "hello.txt" });
	const delta = events.find((e) => e.type === "text_delta");
	assert.ok(delta && delta.type === "text_delta");
	assert.equal(delta.delta, "已读完 hello.txt。");
	const block = draft.content[0] as { type: string; text: string };
	assert.equal(block.text, delta.delta);
});

test("每轮一份新草稿：content 不跨轮累积", () => {
	const first = runOneTurn({ messages: [user] }, model);
	const second = runOneTurn({ messages: [user, toolResult] }, model, { report: false });
	assert.equal(first.content.length, 1);
	assert.equal(second.content.length, 1);
	assert.notEqual(first.content, second.content);
});

test("草稿带着模型与 provider 的名字，usage 全零", () => {
	const draft = createAssistantDraft(model);
	assert.equal(draft.api, "scripted");
	assert.equal(draft.provider, "scripted");
	assert.equal(draft.model, "hello");
	assert.equal(draft.usage.totalTokens, 0);
	assert.equal(draft.usage.cost.total, 0);
});

test("report 打开时第二轮是一大段文本，行数不止一行", () => {
	const draft = runOneTurn({ messages: [user, toolResult] } as Context, model);
	const block = draft.content[0] as { text: string };
	assert.ok(block.text.split("\n").length > 5);
});
