import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCompat, getCompat } from "./compat.ts";
import { fakeTransport, sseChunks } from "./demo-providers.ts";
import { buildPayload, createOpenAILikeApi, finish, INITIAL_STATE, step } from "./openai-like.ts";
import { parsePartialJson, parseSSE } from "./sse.ts";
import type { Model, StreamEvent } from "./types.ts";

const MODEL: Model = { id: "m", provider: "test", api: "openai-completions", baseUrl: "https://llm.example/v1", contextWindow: 8_000, maxTokens: 1_000 };

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function* from(chunks: readonly string[]) {
  for (const chunk of chunks) yield chunk;
}

test("SSE：行被切在任意位置都能拼回来；[DONE] 之后的内容不再读；非 data 行跳过", async () => {
  const text = ': ping\n\ndata: {"a":1}\n\nevent: x\ndata: {"b":2}\r\n\r\ndata: [DONE]\n\ndata: {"c":3}\n\n';
  for (const size of [1, 3, 7, text.length]) {
    const chunks = Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
    assert.deepEqual(await collect(parseSSE(from(chunks))), [{ a: 1 }, { b: 2 }], `块大小 ${size}`);
  }
});

test("SSE：最后一行没有换行也处理；坏 JSON 报错", async () => {
  assert.deepEqual(await collect(parseSSE(from(['data: {"z":1}']))), [{ z: 1 }]);
  await assert.rejects(collect(parseSSE(from(["data: {oops\n"]))), /不是合法 JSON/);
});

test("半截 JSON：能补就补，补不了给空对象", () => {
  assert.deepEqual(parsePartialJson(""), {});
  assert.deepEqual(parsePartialJson('{"path":"src/a'), { path: "src/a" });
  assert.deepEqual(parsePartialJson('{"path":"a.ts","lim'), { path: "a.ts" });
  assert.deepEqual(parsePartialJson('{"items":[1,2'), { items: [1, 2] });
  assert.deepEqual(parsePartialJson('{"q":"say \\"hi'), { q: 'say "hi' });
  assert.deepEqual(parsePartialJson('{"a":'), {});
  assert.deepEqual(parsePartialJson("[1,2]"), {}, "顶层不是对象不算参数");
});

test("推理字段：三种字段名都认，同时出现只取第一个非空的", () => {
  for (const field of ["reasoning_content", "reasoning", "reasoning_text"]) {
    const { events } = step(INITIAL_STATE, { choices: [{ delta: { [field]: "想" } }] });
    assert.deepEqual(events, [{ type: "thinking_delta", delta: "想", field }]);
  }
  const both = step(INITIAL_STATE, { choices: [{ delta: { reasoning_content: "", reasoning: "一次", reasoning_text: "一次" } }] });
  assert.deepEqual(both.events, [{ type: "thinking_delta", delta: "一次", field: "reasoning" }]);
});

test("usage：chunk.usage 优先，没有就看 choice.usage；没有 choices 的 chunk 也能带 usage", () => {
  assert.deepEqual(step(INITIAL_STATE, { choices: [{ delta: {}, usage: { prompt_tokens: 5, completion_tokens: 2 } }] }).state.usage, { input: 5, output: 2 });
  assert.deepEqual(step(INITIAL_STATE, { usage: { prompt_tokens: 9 }, choices: [{ delta: {}, usage: { prompt_tokens: 1 } }] }).state.usage, { input: 9, output: 0 });
  assert.deepEqual(step(INITIAL_STATE, { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }).state.usage, { input: 3, output: 4 });
});

test("工具调用：后续增量只带 index 或只带 id 都能落到同一个块；两个并行调用互不串", () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "read", arguments: '{"p' } }, { index: 1, id: "b", function: { name: "ls", arguments: "{}" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ath":"x"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ id: "a", function: { arguments: "}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls" }] },
  ];
  const state = chunks.reduce((s, c) => step(s, c).state, INITIAL_STATE);
  assert.deepEqual(finish(state, getCompat(MODEL)), {
    type: "done",
    reason: "toolUse",
    inferred: false,
    usage: undefined,
    toolCalls: [
      { id: "a", name: "read", arguments: { path: "x" } },
      { id: "b", name: "ls", arguments: {} },
    ],
  });
});

test("step 是纯函数：不改旧状态", () => {
  const before = step(INITIAL_STATE, { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "r", arguments: "{" } }] } }] }).state;
  const snapshot = JSON.stringify(before);
  step(before, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] }, finish_reason: "stop" }] });
  assert.equal(JSON.stringify(before), snapshot);
});

test("外部数据不可信：形状不对的 chunk 被忽略而不是抛错", () => {
  for (const junk of [null, 42, "x", { choices: "no" }, { choices: [null] }, { choices: [{ delta: { tool_calls: [null, 1] } }] }]) {
    assert.doesNotThrow(() => step(INITIAL_STATE, junk));
  }
});

test("缺 finish_reason：默认报错；声明 supportsFinishReason=false 就按有无工具调用推断", () => {
  const withTool = step(INITIAL_STATE, { choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "x", arguments: "{}" } }] } }] }).state;
  assert.deepEqual(finish(INITIAL_STATE, getCompat(MODEL)), { type: "error", message: "流结束了但没有 finish_reason" });
  const lenient = getCompat({ ...MODEL, compat: { supportsFinishReason: false } });
  assert.equal((finish(INITIAL_STATE, lenient) as { reason: string }).reason, "stop");
  assert.equal((finish(withTool, lenient) as { reason: string }).reason, "toolUse");
  assert.deepEqual(finish({ ...INITIAL_STATE, finishReason: "content_filter" }, lenient), { type: "error", message: "无法识别的 finish_reason：content_filter" });
});

test("detectCompat 靠 provider id 或 URL 猜；换个域名就猜不中，显式 compat 补回", () => {
  const official = { ...MODEL, provider: "x", baseUrl: "https://api.DeepSeek.com" };
  assert.equal(detectCompat(official).maxTokensField, "max_tokens");
  assert.equal(detectCompat({ ...MODEL, provider: "deepseek" }).thinkingFormat, "deepseek");
  assert.equal(detectCompat(MODEL).maxTokensField, "max_completion_tokens");
  assert.equal(getCompat({ ...MODEL, compat: { maxTokensField: "max_tokens" } }).maxTokensField, "max_tokens");
  assert.equal(getCompat({ ...MODEL, compat: { supportsStore: undefined } }).supportsStore, true, "值为 undefined 的键不冲掉猜测");
  assert.equal(detectCompat({ ...MODEL, provider: "openrouter", id: "anthropic/claude" }).supportsDeveloperRole, true);
  assert.equal(detectCompat({ ...MODEL, provider: "openrouter", id: "meta/llama" }).supportsDeveloperRole, false);
});

test("buildPayload：compat 决定 max tokens 字段名、系统消息角色、要不要带 store", () => {
  const ctx = { messages: [{ role: "system" as const, content: "s" }] };
  assert.deepEqual(buildPayload(MODEL, ctx, getCompat(MODEL)), { model: "m", messages: [{ role: "developer", content: "s" }], stream: true, max_completion_tokens: 1_000, store: false });
  const ds = { ...MODEL, provider: "deepseek" };
  assert.deepEqual(buildPayload(ds, ctx, getCompat(ds)), { model: "m", messages: [{ role: "system", content: "s" }], stream: true, max_tokens: 1_000 });
});

test("适配器：onPayload 在发送前且返回值替换 payload；onResponse 在读响应体之前", async () => {
  const order: string[] = [];
  const server = fakeTransport(() => {
    order.push("send");
    return { chunks: sseChunks([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]) };
  });
  const api = createOpenAILikeApi(server.transport);
  const events: StreamEvent[] = [];
  for await (const event of api(MODEL, { messages: [] }, {
    apiKey: "k",
    onPayload: (payload) => {
      order.push("onPayload");
      return { ...(payload as object), injected: true };
    },
    onResponse: (response) => {
      order.push(`onResponse ${response.status}`);
    },
  })) {
    order.push(event.type);
    events.push(event);
  }
  assert.deepEqual(order, ["onPayload", "send", "onResponse 200", "text_delta", "done"]);
  assert.equal((server.received()[0]!.body as { injected?: boolean }).injected, true);
  assert.equal(server.received()[0]!.headers.authorization, "Bearer k");
});

test("适配器：HTTP 错误和钩子里的异常都变成 error 事件，不抛", async () => {
  const failing = createOpenAILikeApi(fakeTransport(() => ({ status: 429, chunks: ["rate limited"] })).transport);
  assert.deepEqual(await collect(failing(MODEL, { messages: [] }, {})), [{ type: "error", message: "HTTP 429：rate limited" }]);
  const ok = createOpenAILikeApi(fakeTransport(() => ({ chunks: [] })).transport);
  const events = await collect(ok(MODEL, { messages: [] }, { onPayload: () => { throw new Error("钩子坏了"); } }));
  assert.deepEqual(events, [{ type: "error", message: "钩子坏了" }]);
});
