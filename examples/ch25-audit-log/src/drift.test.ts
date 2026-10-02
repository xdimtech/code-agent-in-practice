import assert from "node:assert/strict";
import { test } from "node:test";
import { diffPaths } from "./drift.ts";

test("一样的参数没有差异，键序不算差异", () => {
  assert.deepEqual(diffPaths({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), []);
});

test("改了值、加了键、删了键都列出来", () => {
  assert.deepEqual(diffPaths({ command: "npm test", timeout: 5 }, { command: "timeout 600 npm test", cwd: "/w" }), ["command", "cwd", "timeout"]);
});

test("嵌套对象和数组给出完整路径", () => {
  assert.deepEqual(diffPaths({ edits: [{ oldText: "a" }, { oldText: "b" }] }, { edits: [{ oldText: "a" }, { oldText: "c" }] }), ["edits[1].oldText"]);
});

test("数组长度不同，整个数组算一处差异", () => {
  assert.deepEqual(diffPaths({ edits: [1] }, { edits: [1, 2] }), ["edits"]);
});

test("类型变了（字符串被转成数字）也算差异", () => {
  assert.deepEqual(diffPaths({ limit: "10" }, { limit: 10 }), ["limit"]);
});

test("根上的值不同，路径是 $", () => {
  assert.deepEqual(diffPaths("a", "b"), ["$"]);
  assert.deepEqual(diffPaths(undefined, undefined), []);
});
