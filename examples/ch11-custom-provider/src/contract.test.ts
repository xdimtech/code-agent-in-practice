import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHookContract, type ContractViolation } from "./contract.ts";
import { delegatingStream, fakeTransport, selfSendingStream, sseChunks } from "./demo-providers.ts";
import { createOpenAILikeApi } from "./openai-like.ts";
import type { Model, StreamEvent, StreamFn, StreamOptions } from "./types.ts";

const MODEL: Model = { id: "m", provider: "acme", api: "acme-v1", baseUrl: "https://acme.example", contextWindow: 8_000, maxTokens: 1_000 };
const CONTEXT = { messages: [{ role: "user" as const, content: "token=SECRET" }] };
const REDACT: StreamOptions["onPayload"] = (payload) => JSON.parse(JSON.stringify(payload).replaceAll("SECRET", "***"));

function server() {
  return fakeTransport(() => ({ chunks: sseChunks([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, { text: "ok" }]) }));
}

async function run(fn: StreamFn, options: StreamOptions = { onPayload: REDACT }) {
  const violations: ContractViolation[] = [];
  const events: StreamEvent[] = [];
  for await (const event of checkHookContract(fn, "observe", (v) => violations.push(v))(MODEL, CONTEXT, options)) events.push(event);
  return { violations, events };
}

test("自己发请求的 streamSimple：脱敏钩子被绕过，契约检查报两个缺失", async () => {
  const s = server();
  const { violations, events } = await run(selfSendingStream(s.transport));
  assert.match(JSON.stringify(s.received()[0]!.body), /SECRET/);
  assert.deepEqual(violations, [{ provider: "acme", model: "m", missing: ["onPayload", "onResponse"] }]);
  assert.equal(events.at(-1)?.type, "done", "observe 模式只报告，事件照常往下走");
});

test("内置适配器和委托内置适配器的写法：钩子生效，没有违约", async () => {
  for (const make of [(t: ReturnType<typeof server>) => createOpenAILikeApi(t.transport), (t: ReturnType<typeof server>) => delegatingStream(createOpenAILikeApi(t.transport), () => "x")]) {
    const s = server();
    const { violations } = await run(make(s));
    assert.deepEqual(violations, []);
    assert.doesNotMatch(JSON.stringify(s.received()[0]!.body), /SECRET/);
  }
});

test("委托写法换掉的凭证真的传到了内置适配器", async () => {
  const s = server();
  await run(delegatingStream(createOpenAILikeApi(s.transport), (original) => `exchanged-from-${original}`), { apiKey: "raw" });
  assert.equal(s.received()[0]!.headers.authorization, "Bearer exchanged-from-raw");
});

test("enforce 模式：违约时用 error 事件收尾，但请求已经发出", async () => {
  const s = server();
  const events: StreamEvent[] = [];
  for await (const event of checkHookContract(selfSendingStream(s.transport), "enforce", () => undefined)(MODEL, CONTEXT, {})) events.push(event);
  assert.equal(events.length, 1);
  assert.match((events[0] as { message: string }).message, /没有调用 onPayload、onResponse/);
  assert.equal(s.received().length, 1);
});

test("发请求之前就失败的流不算违约", async () => {
  const early: StreamFn = async function* () {
    yield { type: "error", message: "No API key" };
  };
  const { violations, events } = await run(early);
  assert.deepEqual(violations, []);
  assert.deepEqual(events, [{ type: "error", message: "No API key" }]);
});

test("只调了 onPayload、没调 onResponse，也能查出来", async () => {
  const halfway: StreamFn = async function* (model, _context, options) {
    await options.onPayload?.({}, model);
    yield { type: "text_delta", delta: "x" };
  };
  assert.deepEqual((await run(halfway)).violations[0]?.missing, ["onResponse"]);
});
