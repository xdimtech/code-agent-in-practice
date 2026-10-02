import { test } from "node:test";
import assert from "node:assert/strict";
import { emitBeforeAgentStart, emitContext, type BeforeAgentStartHandler, type ContextHandler, type Named } from "./inject.ts";
import { EMPTY_SESSION, runTurn, type SessionConfig } from "./session.ts";
import type { Message } from "./types.ts";

const named = <T>(name: string, handler: T): Named<T> => ({ name, handler });

test("before_agent_start：后一个处理器看到的是前一个改过的 system prompt", () => {
  const seen: string[] = [];
  const handlers = [
    named<BeforeAgentStartHandler>("a", (e) => ({ systemPrompt: `${e.systemPrompt}+a` })),
    named<BeforeAgentStartHandler>("b", (e) => (seen.push(e.systemPrompt), { systemPrompt: `${e.systemPrompt}+b` })),
  ];
  assert.equal(emitBeforeAgentStart(handlers, "p", "base").systemPrompt, "base+a+b");
  assert.deepEqual(seen, ["base+a"]);
});

test("before_agent_start：抛错的处理器被记下，前后的照常生效", () => {
  const handlers = [
    named<BeforeAgentStartHandler>("a", () => ({ message: { customType: "x", content: "1" } })),
    named<BeforeAgentStartHandler>("boom", () => { throw new Error("坏了"); }),
    named<BeforeAgentStartHandler>("c", () => ({ message: { customType: "x", content: "2" }, systemPrompt: "S" })),
  ];
  const outcome = emitBeforeAgentStart(handlers, "p", "base");
  assert.deepEqual(outcome.messages.map((m) => m.content), ["1", "2"]);
  assert.deepEqual(outcome.errors, [{ handler: "boom", event: "before_agent_start", error: "坏了" }]);
  assert.equal(outcome.systemPrompt, "S");
});

test("before_agent_start：没人改 system prompt 时结果是 undefined，而不是基础版本的拷贝", () => {
  const outcome = emitBeforeAgentStart([named<BeforeAgentStartHandler>("noop", () => undefined)], "p", "base");
  assert.equal(outcome.systemPrompt, undefined);
});

test("context：链式改写；不返回就保持原样；出错不连累别人；原数组不变", () => {
  const original: readonly Message[] = [{ role: "user", content: "hi" }];
  const handlers = [
    named<ContextHandler>("add", (m) => [...m, { role: "user", content: "tail" }]),
    named<ContextHandler>("noop", () => undefined),
    named<ContextHandler>("boom", () => { throw new Error("x"); }),
  ];
  const result = emitContext(handlers, original);
  assert.deepEqual(result.messages.map((m) => m.content), ["hi", "tail"]);
  assert.equal(result.errors.length, 1);
  assert.equal(original.length, 1);
});

const base: SessionConfig = { tools: [], baseSystemPrompt: "BASE", reply: (n) => `r${n}` };

test("一轮：用户消息在前，扩展消息在后；两者都进历史，助手回复接在最后", () => {
  const config = { ...base, beforeAgentStart: [named<BeforeAgentStartHandler>("m", () => ({ message: { customType: "note", content: "N" } }))] };
  const { request, state } = runTurn(config, EMPTY_SESSION, "U");
  assert.deepEqual(request.messages.map((m) => m.content), ["U", "N"]);
  assert.deepEqual(state.history.map((m) => m.content), ["U", "N", "r1"]);
});

test("覆盖只管一轮：下一轮没人改就退回基础版本", () => {
  const override = { ...base, beforeAgentStart: [named<BeforeAgentStartHandler>("s", () => ({ systemPrompt: "OVERRIDE" }))] };
  const first = runTurn(override, EMPTY_SESSION, "1");
  assert.equal(first.request.system, "OVERRIDE");
  assert.equal(runTurn(base, first.state, "2").request.system, "BASE");
});

test("context 钩子的改动只进请求，不进历史", () => {
  const config = { ...base, context: [named<ContextHandler>("tail", (m) => [...m, { role: "user", content: "T" }])] };
  const { request, state } = runTurn(config, EMPTY_SESSION, "U");
  assert.deepEqual(request.messages.map((m) => m.content), ["U", "T"]);
  assert.deepEqual(state.history.map((m) => m.content), ["U", "r1"]);
});

test("context 钩子过滤掉已经持久化的注入消息：这一轮的请求前缀跟上一轮不一样了", () => {
  const inject = { ...base, beforeAgentStart: [named<BeforeAgentStartHandler>("m", () => ({ message: { customType: "plan", content: "PLAN" } }))] };
  const first = runTurn(inject, EMPTY_SESSION, "1");
  const filter = { ...base, context: [named<ContextHandler>("drop", (m) => m.filter((x) => x.customType !== "plan"))] };
  const second = runTurn(filter, first.state, "2");
  assert.deepEqual(second.request.messages.map((m) => m.content), ["1", "r1", "2"]);
  assert.ok(second.state.history.some((m) => m.customType === "plan"), "历史里还在");
});
