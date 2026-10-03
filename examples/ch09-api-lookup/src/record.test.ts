import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRecord, toRecord } from "./record.ts";

const FAKE_SECRET = ["sk", "ant", "x".repeat(20)].join("-");

test("只留白名单里的标量字段，不留内容", () => {
  const r = toRecord("tool_call", { type: "tool_call", toolCallId: "c1", toolName: "bash", input: { command: `curl -H ${FAKE_SECRET}` } }, 3);
  assert.deepEqual(r, { seq: 3, type: "tool_call", toolCallId: "c1", toolName: "bash" });
  assert.ok(!JSON.stringify(r).includes(FAKE_SECRET));
});

test("消息事件留 role 和 stopReason，不留正文", () => {
  const r = toRecord("message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: FAKE_SECRET }] } }, 1);
  assert.deepEqual(r, { seq: 1, type: "message_end", role: "assistant", stopReason: "stop" });
});

test("请求体、HTTP 头、用户输入、! 命令一律不录", () => {
  const cases = [
    toRecord("before_provider_request", { payload: { key: FAKE_SECRET } }, 1),
    toRecord("before_provider_headers", { headers: { authorization: FAKE_SECRET } }, 2),
    toRecord("input", { text: FAKE_SECRET, source: "interactive" }, 3),
    toRecord("user_bash", { command: `echo ${FAKE_SECRET}`, excludeFromContext: true, cwd: "/w" }, 4),
    toRecord("before_agent_start", { prompt: FAKE_SECRET, systemPrompt: FAKE_SECRET }, 5),
  ];
  for (const r of cases) assert.ok(!JSON.stringify(r).includes(FAKE_SECRET), r.type as string);
  assert.equal(cases[2].source, "interactive");
  assert.equal(cases[3].excludeFromContext, true);
});

test("白名单字段不是标量就丢掉；事件不是对象也不出错", () => {
  assert.deepEqual(toRecord("session_start", { reason: { nested: 1 } }, 1), { seq: 1, type: "session_start" });
  assert.deepEqual(toRecord("agent_start", undefined, 2), { seq: 2, type: "agent_start" });
});

test("流式增量只录第一条：同一条消息、同一次工具调用", () => {
  let seen: ReadonlySet<string> = new Set();
  const step = (type: Parameters<typeof shouldRecord>[0], event: unknown = {}) => {
    const r = shouldRecord(type, event, seen);
    seen = r.seen;
    return r.record;
  };
  assert.deepEqual([step("message_start"), step("message_update"), step("message_update"), step("message_end")], [true, true, false, true]);
  assert.deepEqual([step("message_start"), step("message_update")], [true, true]);
  const a = { toolCallId: "a" };
  const b = { toolCallId: "b" };
  assert.deepEqual([step("tool_execution_update", a), step("tool_execution_update", b), step("tool_execution_update", a)], [true, true, false]);
});

test("shouldRecord 不改传进来的集合", () => {
  const seen = new Set<string>(["message"]);
  shouldRecord("message_start", {}, seen);
  shouldRecord("tool_execution_update", { toolCallId: "x" }, seen);
  assert.deepEqual([...seen], ["message"]);
});
