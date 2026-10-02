import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchToolCall, dispatchUserBash, type ToolCallHandler, type UserBashHandler } from "./host.ts";

const BASH = { toolName: "bash", input: { command: "ls" } };
const USER = { command: "ls", cwd: "/work/repo" };
const boom = (): never => {
  throw new Error("坏了");
};
const result = (output: string) => ({ result: { output, exitCode: 0, cancelled: false, truncated: false } });

test("没有处理器：两条路都执行", async () => {
  assert.equal((await dispatchToolCall([], BASH)).ran, true);
  assert.equal((await dispatchUserBash([], USER)).ran, true);
});

test("tool_call：第一个 block 生效，后面的处理器不再调用", async () => {
  let later = false;
  const handlers: ToolCallHandler[] = [() => undefined, () => ({ block: true, reason: "不行" }), () => ((later = true), undefined)];
  assert.deepEqual(await dispatchToolCall(handlers, BASH), { ran: false, reason: "不行", swallowed: [] });
  assert.equal(later, false);
});

test("tool_call：处理器抛错 = 没执行（关着失败）", async () => {
  assert.deepEqual(await dispatchToolCall([boom], BASH), { ran: false, reason: "坏了", swallowed: [] });
  assert.deepEqual(await dispatchToolCall([async () => Promise.reject("字符串")], BASH), { ran: false, reason: "字符串", swallowed: [] });
});

test("user_bash：处理器抛错被吞掉，命令照常执行（开着失败）", async () => {
  assert.deepEqual(await dispatchUserBash([boom], USER), { ran: true, swallowed: ["坏了"] });
});

test("user_bash：抛错的处理器后面那个还会被调用", async () => {
  const handlers: UserBashHandler[] = [boom, () => result("拦下了")];
  assert.deepEqual(await dispatchUserBash(handlers, USER), { ran: false, reason: "拦下了", swallowed: ["坏了"] });
});

test("user_bash：想拦只能给一个顶替的结果；第一个给出结果的生效", async () => {
  assert.deepEqual(await dispatchUserBash([() => result("一"), () => result("二")], USER), { ran: false, reason: "一", swallowed: [] });
});
