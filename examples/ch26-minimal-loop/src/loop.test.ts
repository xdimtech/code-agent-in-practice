import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoop, type LoopEvent, type Message } from "./loop.ts";
import { scriptedModel } from "./scripted-model.ts";

const user = (text: string): Message => ({ role: "user", text });
const say = (text: string): Message => ({ role: "assistant", text, stopReason: "stop" });
const noop = (): void => {};

test("没有工具调用时一轮即结束（出口③）", async () => {
  const out = await runLoop([user("hi")], { callModel: scriptedModel([say("hello")]), tools: [] }, noop);
  assert.deepEqual(out.map((m) => m.text), ["hello"]);
});

test("模型异常变成 error 消息而不是抛出（出口①）", async () => {
  const callModel = async (): Promise<Message> => {
    throw new Error("boom");
  };
  const out = await runLoop([user("hi")], { callModel, tools: [] }, noop);
  assert.equal(out.at(-1)?.stopReason, "error");
  assert.equal(out.at(-1)?.text, "boom");
});

test("shouldStopAfterTurn 能截断无限工具调用（出口②）", async () => {
  const forever: Message = { role: "assistant", text: "再来", toolCalls: [{ id: "x", name: "echo", args: {} }] };
  const callModel = async (): Promise<Message> => forever;
  const echo = { name: "echo", execute: async () => "ok" };
  const out = await runLoop(
    [user("go")],
    { callModel, tools: [echo], shouldStopAfterTurn: ({ turnIndex }) => turnIndex >= 3 },
    noop,
  );
  assert.equal(out.filter((m) => m.role === "assistant").length, 3);
});

test("follow-up 在模型停下后才被注入（外层循环）", async () => {
  const queue: Message[][] = [[user("第二件事")]];
  const events: LoopEvent[] = [];
  const out = await runLoop(
    [user("第一件事")],
    { callModel: scriptedModel([say("做完一"), say("做完二")]), tools: [], getFollowUp: () => queue.shift() ?? [] },
    (e) => events.push(e),
  );
  assert.deepEqual(out.map((m) => m.text), ["做完一", "第二件事", "做完二"]);
  assert.equal(events.filter((e) => e.type === "agent_end").length, 1);
});

test("调用者传入的快照不被修改", async () => {
  const snapshot = Object.freeze([user("hi")]);
  await runLoop(snapshot, { callModel: scriptedModel([say("hello")]), tools: [] }, noop);
  assert.equal(snapshot.length, 1);
});

test("未知工具返回 error 结果，循环继续", async () => {
  const script: Message[] = [
    { role: "assistant", text: "", toolCalls: [{ id: "a", name: "nope", args: {} }] },
    say("换个办法"),
  ];
  const out = await runLoop([user("go")], { callModel: scriptedModel(script), tools: [] }, noop);
  assert.equal(out[1].stopReason, "error");
  assert.equal(out.at(-1)?.text, "换个办法");
});
