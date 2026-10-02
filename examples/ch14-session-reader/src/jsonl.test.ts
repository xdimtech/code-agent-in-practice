import assert from "node:assert/strict";
import { test } from "node:test";
import { HEADER, jsonl, user } from "./fixtures.ts";
import { parseSession, SessionFormatError } from "./jsonl.ts";

test("正常文件：头 + 条目，没有问题", () => {
  const p = parseSession(jsonl(HEADER, user("a", null), user("b", "a")));
  assert.equal(p.header.id, "s-1");
  assert.deepEqual(p.entries.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(p.problems, []);
  assert.equal(p.needsMigration, false);
  assert.equal(p.missingTrailingNewline, false);
});

test("坏行照样跳过，但记下行号和原因", () => {
  const p = parseSession(jsonl(HEADER, user("a", null), '{"type":"message","id":"x', user("b", "a")));
  assert.deepEqual(p.entries.map((e) => e.id), ["a", "b"]);
  assert.equal(p.problems.length, 1);
  assert.equal(p.problems[0]!.line, 3);
  assert.equal(p.problems[0]!.kind, "malformed-json");
});

test("能解析但不像条目的行：分别说缺什么", () => {
  const p = parseSession(
    jsonl(
      HEADER,
      [1, 2],
      { id: "a", parentId: null, timestamp: "t" },
      { type: "message", parentId: null, timestamp: "t", message: { role: "user" } },
      { type: "message", id: "b", parentId: 7, timestamp: "t" },
      { type: "message", id: "c", parentId: null, message: { role: "user" } },
      { type: "message", id: "d", parentId: null, timestamp: "t", message: {} },
    ),
  );
  assert.deepEqual(
    p.problems.map((x) => x.detail),
    ["不是 JSON 对象", "缺 type", "缺 id", "parentId 既不是字符串也不是 null", "缺 timestamp", "message 条目缺 message.role"],
  );
  assert.ok(p.problems.every((x) => x.kind === "not-an-entry"));
});

test("第二个会话头记为问题，不覆盖第一个", () => {
  const p = parseSession(jsonl(HEADER, { ...HEADER, id: "s-2" }));
  assert.equal(p.header.id, "s-1");
  assert.equal(p.problems[0]!.kind, "extra-header");
});

test("第一条有效行不是头：和 pi 一样拒绝", () => {
  assert.throws(() => parseSession(jsonl(user("a", null))), SessionFormatError);
  assert.throws(() => parseSession(""), /没有会话头/);
  assert.throws(() => parseSession("\n\n"), SessionFormatError);
});

test("头前面的坏行和空行不算有效行", () => {
  const p = parseSession(jsonl("{oops", "", HEADER, user("a", null)));
  assert.equal(p.problems[0]!.line, 1);
  assert.equal(p.entries.length, 1);
});

test("旧版本要迁移；末行缺换行要提示", () => {
  const { version: _v, ...v1 } = HEADER;
  const p = parseSession(JSON.stringify(v1) + "\n" + JSON.stringify(user("a", null)));
  assert.equal(p.needsMigration, true);
  assert.equal(p.missingTrailingNewline, true);
});
