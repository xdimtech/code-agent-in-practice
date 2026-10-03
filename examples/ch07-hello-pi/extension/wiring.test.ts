import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedProvider } from "./wiring.ts";
import type { Context } from "../src/types.ts";

/** 假流：把推过来的事件收进数组。真实流要装在 pi 里才有。 */
function fakeStream() {
	const events: unknown[] = [];
	let ended = false;
	return {
		stream: {
			push(event: unknown) {
				events.push(event);
			},
			end() {
				ended = true;
			},
		},
		get events() {
			return events;
		},
		get ended() {
			return ended;
		},
	};
}

const user: Context = { messages: [{ role: "user", content: [{ type: "text", text: "读一下" }] }] };
const settings = () => ({ file: "hello.txt", tool: "read", report: true });
const model = { id: "hello", api: "scripted", provider: "scripted" };

/** 流是异步推的（queueMicrotask），等一轮。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const types = (fake: ReturnType<typeof fakeStream>) => fake.events.map((e) => (e as { type: string }).type);
const readPath = (fake: ReturnType<typeof fakeStream>) => {
	const end = fake.events.find((e) => (e as { type: string }).type === "toolcall_end") as {
		toolCall: { arguments: { path: string } };
	};
	return end.toolCall.arguments.path;
};

test("注册的形状：名字、api、一个模型，apiKey 是占位符", () => {
	const provider = createScriptedProvider(settings, () => fakeStream().stream);
	assert.equal(provider.api, "scripted");
	assert.equal(provider.models.length, 1);
	assert.equal(provider.models[0].id, "hello");
	assert.equal(provider.models[0].cost.total, 0);
	assert.equal(provider.apiKey, "scripted-no-key-needed");
	assert.ok(!provider.models[0].name.includes("key"));
});

test("streamSimple：异步推事件，推完 end()", async () => {
	const fake = fakeStream();
	const provider = createScriptedProvider(settings, () => fake.stream);
	provider.streamSimple(model, user);
	assert.equal(fake.events.length, 0, "同步阶段一个都不推：pi 还没订阅");
	await flush();
	assert.deepEqual(types(fake), ["start", "toolcall_start", "toolcall_end", "done"]);
	assert.equal(fake.ended, true);
});

test("settings 是延迟读的：每轮用当时的值", async () => {
	let file = "default.txt";
	// createStream 每次调用造一条新流；把造出来的收好，才能看到推了什么。
	const made: ReturnType<typeof fakeStream>[] = [];
	const provider = createScriptedProvider(
		() => ({ file, tool: "read", report: false }),
		() => {
			const fake = fakeStream();
			made.push(fake);
			return fake.stream;
		},
	);

	provider.streamSimple(model, user);
	await flush();
	assert.equal(readPath(made[0]), "default.txt", "第一轮用第一轮当时的值");

	file = "later.txt";
	provider.streamSimple(model, user);
	await flush();
	assert.equal(readPath(made[1]), "later.txt", "第二轮用改过之后的值");
	assert.equal(made[1].events.length, 4);
});

test("每一轮一份新草稿，content 不跨轮累积", async () => {
	const fake = fakeStream();
	const provider = createScriptedProvider(settings, () => fake.stream);
	provider.streamSimple(model, user);
	await flush();
	const started = fake.events.filter((e) => (e as { type: string }).type === "start") as { partial: { content: unknown[] } }[];
	assert.equal(started.length, 1);
	assert.equal(started[0].partial.content.length, 1);
});

test("出错时推一条 error 并关流，不让宿主一直等", async () => {
	const fake = fakeStream();
	const provider = createScriptedProvider(
		() => {
			throw new Error("settings 炸了");
		},
		() => fake.stream,
	);
	provider.streamSimple(model, user);
	await flush();
	assert.deepEqual(types(fake), ["error"]);
	assert.match(String((fake.events[0] as { error: Error }).error.message), /settings 炸了/);
	assert.equal(fake.ended, true, "出错也必须 end()");
});

test("第二轮：上下文里有 toolResult 时推文本", async () => {
	const fake = fakeStream();
	const provider = createScriptedProvider(settings, () => fake.stream);
	provider.streamSimple(model, {
		messages: [
			...user.messages,
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "read",
				content: [{ type: "text", text: "hello" }],
				isError: false,
			},
		],
	} as Context);
	await flush();
	assert.deepEqual(types(fake), ["start", "text_start", "text_delta", "text_end", "done"]);
});
