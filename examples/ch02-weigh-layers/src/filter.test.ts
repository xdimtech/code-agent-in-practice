import { test } from "node:test";
import assert from "node:assert/strict";
import { countLines, isCountedSource } from "./filter.ts";

test("只算 /src/ 下的 .ts / .tsx", () => {
  assert.equal(isCountedSource("packages/agent/src/agent-loop.ts"), true);
  assert.equal(isCountedSource("packages/tui/src/components/editor.tsx"), true);
  assert.equal(isCountedSource("packages/agent/src/agent-loop.js"), false);
  assert.equal(isCountedSource("packages/ai/scripts/generate-models.ts"), false);
});

test("与 shell 管道一致：仓库根下的 src/ 不算（grep '/src/' 要求前面有一段路径）", () => {
  assert.equal(isCountedSource("src/index.ts"), false);
});

test("排除测试文件与测试目录", () => {
  assert.equal(isCountedSource("packages/agent/src/agent.test.ts"), false);
  assert.equal(isCountedSource("packages/agent/src/agent.spec.tsx"), false);
  assert.equal(isCountedSource("packages/agent/test/src/fixture.ts"), false);
  assert.equal(isCountedSource("packages/agent/src/tests/helper.ts"), false);
  assert.equal(isCountedSource("tests/src/x.ts"), false);
});

test("排除 examples/，但不误伤名字里带 test 的源文件", () => {
  assert.equal(isCountedSource("packages/coding-agent/examples/src/ext.ts"), false);
  assert.equal(isCountedSource("packages/agent/src/harness/session/testing/conformance.ts"), true);
  assert.equal(isCountedSource("packages/agent/src/latest.ts"), true);
});

test("countLines 与 wc -l 相同：数换行符", () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  assert.equal(countLines(enc("")), 0);
  assert.equal(countLines(enc("a\nb\n")), 2);
  assert.equal(countLines(enc("a\nb")), 1);
  assert.equal(countLines(enc("中文\r\n")), 1);
});
