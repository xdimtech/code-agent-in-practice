import assert from "node:assert/strict";
import { test } from "node:test";
import { badTrace, docsOrderTrace, goodTrace, retryTrace } from "./fixtures.ts";
import { checkOrder, hasErrors, parseTrace } from "./order.ts";

const rules = (text: string) => checkOrder(text).findings.map((f) => f.rule);
const lines = (...types: readonly (string | Readonly<Record<string, unknown>>)[]) => types.map((t) => JSON.stringify(typeof t === "string" ? { type: t } : t)).join("\n");
const tool = (type: string, id = "c1") => ({ type, toolCallId: id });

test("照代码顺序写的 trace：没有错误，被拦下的调用记一条 info", () => {
  const r = checkOrder(goodTrace());
  assert.ok(!hasErrors(r));
  assert.deepEqual(r.findings.map((f) => f.rule), ["blocked"]);
  assert.equal(r.counts.tool_execution_start, 2);
});

test("照文档生命周期图写的 trace：用户消息在 turn_start 之前，提醒", () => {
  const r = checkOrder(docsOrderTrace());
  assert.ok(!hasErrors(r));
  assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["message-outside-turn", 3]]);
});

test("写错的 trace：每种错都报出来，按行号排", () => {
  const r = checkOrder(badTrace());
  assert.ok(hasErrors(r));
  assert.deepEqual(r.findings.map((f) => f.rule), ["request-before-context", "call-before-start", "not-json", "unknown-event", "settled-while-running", "agent-unfinished"]);
});

test("自动重试：两对 agent_start / agent_end，一次 settled", () => {
  assert.deepEqual(rules(retryTrace()), ["settled-after-continue"]);
});

test("parseTrace：空行跳过，没有 type 的行报错", () => {
  const p = parseTrace(`${lines("agent_start")}\n\n{"x":1}\n[1]\n`);
  assert.equal(p.events.length, 1);
  assert.deepEqual(p.findings.map((f) => [f.rule, f.line]), [["no-type", 3], ["no-type", 4]]);
});

test("工具：没有 tool_call 也没有 tool_result 的调用（参数校验失败、输出被截断）", () => {
  assert.deepEqual(rules(lines(tool("tool_execution_start"), tool("tool_call", "c2"), tool("tool_execution_start", "c2"), tool("tool_execution_end"))), ["call-before-start", "not-prepared", "tool-unfinished"]);
});

test("工具：trace 里完全没有 tool_call 时（只录了 tool_execution_*）不按拦截判断", () => {
  assert.deepEqual(rules(lines(tool("tool_execution_start"), tool("tool_execution_update"), tool("tool_execution_end"))), []);
});

test("工具：end 没有 start、update 在 end 之后、重复的 start", () => {
  assert.deepEqual(rules(lines(tool("tool_execution_end"))), ["end-without-start"]);
  assert.deepEqual(rules(lines(tool("tool_execution_start"), tool("tool_execution_end"), tool("tool_execution_update"))), ["update-outside"]);
  assert.deepEqual(rules(lines(tool("tool_execution_start"), tool("tool_execution_start"), tool("tool_execution_end"))), ["tool-restarted"]);
});

test("工具：没有 toolCallId 的行不参与配对", () => {
  assert.deepEqual(rules(lines("tool_call", "tool_result")), []);
});

test("并行执行：两个调用交错也没问题（agent-loop.ts:498-530）", () => {
  const t = lines(tool("tool_execution_start", "a"), tool("tool_call", "a"), tool("tool_execution_start", "b"), tool("tool_call", "b"), tool("tool_result", "b"), tool("tool_result", "a"), tool("tool_execution_end", "b"), tool("tool_execution_end", "a"));
  assert.deepEqual(rules(t), []);
});

test("嵌套：轮不在运行里、轮没结束就 agent_end、重入", () => {
  assert.deepEqual(rules(lines("turn_start", "turn_end")), ["turn-outside-agent"]);
  assert.deepEqual(rules(lines("agent_start", "turn_start", "agent_end")), ["turn-open-at-agent-end"]);
  assert.deepEqual(rules(lines("agent_start", "agent_start", "agent_end")), ["agent-reentered"]);
  assert.deepEqual(rules(lines("agent_start", "turn_start", "turn_start", "turn_end", "agent_end")), ["turn-reentered"]);
  assert.deepEqual(rules(lines("agent_end")), ["agent-end-without-start"]);
});

test("嵌套：运行失败时宿主补发的 turn_end 只提醒", () => {
  assert.deepEqual(rules(lines("agent_start", "turn_start", "turn_end", "turn_end", "agent_end")), ["turn-end-without-start"]);
});

test("消息：update 在消息外、end 没有 start、重入", () => {
  assert.deepEqual(rules(lines("agent_start", "turn_start", "message_update", "message_end", "turn_end", "agent_end")), ["update-outside-message", "message-end-without-start"]);
  assert.deepEqual(rules(lines("agent_start", "turn_start", "message_start", "message_start", "message_end", "turn_end", "agent_end")), ["message-reentered"]);
});

test("settled：前面没有 agent_end 是错", () => {
  assert.deepEqual(rules(lines("agent_settled")), ["settled-without-end"]);
});

test("请求：headers 也必须在 context 之后；每轮重新算", () => {
  assert.deepEqual(rules(lines("agent_start", "turn_start", "context", "turn_end", "turn_start", "before_provider_headers", "turn_end", "agent_end")), ["request-before-context"]);
});

test("ui_prompt_* 在微任务里发，不参与顺序检查", () => {
  assert.deepEqual(rules(lines("ui_prompt_end", "ui_prompt_start")), []);
});
