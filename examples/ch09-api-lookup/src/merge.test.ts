import assert from "node:assert/strict";
import { test } from "node:test";
import { mutates, returns, simulate, throws } from "./merge.ts";

test("notify：返回值忽略，抛错各自记下，后面的照样调用", () => {
  const r = simulate("notify", [returns("a", { anything: 1 }), throws("b", "坏了"), returns("c", 2)]);
  assert.equal(r.outcome, undefined);
  assert.deepEqual(r.called, ["a", "b", "c"]);
  assert.deepEqual(r.errors, ["b: 坏了"]);
});

test("cancel：第一个 cancel 短路", () => {
  const r = simulate("cancel", [returns("a", { cancel: true }), returns("b", { compaction: {} })]);
  assert.deepEqual(r.outcome, { cancel: true });
  assert.deepEqual(r.called, ["a"]);
});

test("cancel：没人 cancel 时最后一个非空结果胜出，空结果不覆盖", () => {
  const r = simulate("cancel", [returns("a", { compaction: { summary: "A" } }), returns("b", { compaction: { summary: "B" } }), returns("c", undefined)]);
  assert.deepEqual(r.outcome, { compaction: { summary: "B" } });
});

test("first-decided：undecided 往下传，第一个 yes/no 胜出", () => {
  const r = simulate("first-decided", [returns("a", { trusted: "undecided" }), returns("b", { trusted: "yes" }), returns("c", { trusted: "no" })]);
  assert.deepEqual(r.outcome, { trusted: "yes" });
  assert.deepEqual(r.called, ["a", "b"]);
});

test("first-decided：返回 undefined 记成 TypeError，全 undecided 就是没决定", () => {
  const r = simulate("first-decided", [returns("a", undefined), returns("b", { trusted: "undecided" })]);
  assert.equal(r.outcome, undefined);
  assert.match(r.errors[0], /TypeError/);
});

test("collect：三类路径都收集，记上来源扩展", () => {
  const r = simulate("collect", [returns("a", { skillPaths: ["/s1"] }), throws("b", "x"), returns("c", { skillPaths: ["/s2"], themePaths: ["/t"] })]);
  assert.deepEqual(r.outcome, [
    { kind: "skillPaths", path: "/s1", ext: "a" },
    { kind: "skillPaths", path: "/s2", ext: "c" },
    { kind: "themePaths", path: "/t", ext: "c" },
  ]);
  assert.equal(r.errors.length, 1);
});

test("chain：前一个的输出是后一个的输入；undefined 不覆盖；抛错的那一份丢失", () => {
  const r = simulate("chain", [returns("a", { v: 1 }), returns("b", undefined), throws("c", "坏了"), returns("d", { v: 2 })], { v: 0 });
  assert.deepEqual(r.outcome, { v: 2 });
  const failed = simulate("chain", [throws("redact", "正则写错了")], { secret: "原文" });
  assert.deepEqual(failed.outcome, { secret: "原文" });
  assert.deepEqual(failed.errors, ["redact: 正则写错了"]);
});

test("in-place：返回值忽略；null 是删除；改完再抛错，修改仍然生效", () => {
  const r = simulate("in-place", [returns("a", { ignored: "1" }), mutates("b", { "x-b": "1", "x-title": null }), mutates("c", { "x-c": "1" }, "然后抛错")], { "x-title": "pi" });
  assert.deepEqual(r.outcome, { "x-b": "1", "x-c": "1" });
  assert.deepEqual(r.errors, ["c: 然后抛错"]);
});

test("prompt：message 累加，systemPrompt 串联；都没给就是 undefined", () => {
  const r = simulate("prompt", [returns("a", { message: "m1", systemPrompt: "S+a" }), returns("b", { message: "m2" }), returns("c", { systemPrompt: "S+a+c" })], { systemPrompt: "S" });
  assert.deepEqual(r.outcome, { messages: ["m1", "m2"], systemPrompt: "S+a+c" });
  assert.equal(simulate("prompt", [returns("a", {})], { systemPrompt: "S" }).outcome, undefined);
});

test("same-role：role 变了被拒，之前的替换保留", () => {
  const r = simulate("same-role", [returns("a", { message: { role: "assistant", v: 1 } }), returns("b", { message: { role: "user", v: 2 } })], { role: "assistant", v: 0 });
  assert.deepEqual(r.outcome, { role: "assistant", v: 1 });
  assert.match(r.errors[0], /same role/);
  assert.equal(simulate("same-role", [returns("a", undefined)], { role: "assistant" }).outcome, undefined);
});

test("per-field：只改给了的字段，各字段独立串联", () => {
  const r = simulate("per-field", [returns("a", { content: ["截断后"] }), returns("b", { isError: true }), returns("c", { details: undefined })], { content: ["原文"], details: { d: 1 }, isError: false });
  assert.deepEqual(r.outcome, { content: ["截断后"], details: { d: 1 }, isError: true });
  assert.equal(simulate("per-field", [returns("a", {})], { content: [] }).outcome, undefined);
});

test("block：第一个 block 短路，后面的看不到", () => {
  const r = simulate("block", [returns("a", { block: true, reason: "受保护路径" }), returns("b", undefined)], { path: ".env" });
  assert.deepEqual(r.outcome, { blocked: true, reason: "受保护路径", input: { path: ".env" } });
  assert.deepEqual(r.called, ["a"]);
});

test("block：抛错不被 runner 接住，等于拦下", () => {
  const r = simulate("block", [throws("audit", "写不进去"), returns("b", undefined)], {});
  assert.equal(r.threw, "audit: 写不进去");
  assert.deepEqual(r.errors, []);
  assert.equal((r.outcome as { blocked: boolean }).blocked, true);
  assert.deepEqual(r.called, ["audit"]);
});

test("block：就地改 input 是改参数的唯一办法，改动传给下一个处理函数和工具", () => {
  const r = simulate("block", [mutates("timeout", { command: "timeout 600 npm test" }), returns("ok", undefined)], { command: "npm test" });
  assert.deepEqual(r.outcome, { blocked: false, input: { command: "timeout 600 npm test" } });
});

test("first-result：第一个非空结果胜出；抛错被吞掉、继续往下", () => {
  const r = simulate("first-result", [throws("a", "x"), returns("b", undefined), returns("c", { result: "远端" }), returns("d", { result: "另一个" })]);
  assert.deepEqual(r.outcome, { result: "远端" });
  assert.deepEqual(r.called, ["a", "b", "c"]);
});

test("transform：串联改写，handled 短路，没变化就是 continue", () => {
  const chained = simulate("transform", [returns("a", { action: "transform", text: "A" }), returns("b", { action: "transform", text: "AB" })], "原文");
  assert.deepEqual(chained.outcome, { action: "transform", text: "AB" });
  const handled = simulate("transform", [returns("a", { action: "handled" }), returns("b", { action: "transform", text: "x" })], "原文");
  assert.deepEqual(handled.outcome, { action: "handled" });
  assert.deepEqual(handled.called, ["a"]);
  assert.deepEqual(simulate("transform", [returns("a", { action: "continue" })], "原文").outcome, { action: "continue" });
});

test("不改传进来的初始值", () => {
  const initial = Object.freeze({ "x-title": "pi" });
  simulate("in-place", [mutates("a", { "x-title": null })], initial);
  simulate("block", [mutates("a", { "x-title": "改" })], initial);
  assert.deepEqual(initial, { "x-title": "pi" });
});
