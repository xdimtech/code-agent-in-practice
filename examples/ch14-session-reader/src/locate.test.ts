import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionFileName, sessionDirName, sessionFileName } from "./locate.ts";

test("目录名：去掉开头的分隔符，其余 / \\ : 换成 -", () => {
  assert.equal(sessionDirName("/work/shop"), "--work-shop--");
  assert.equal(sessionDirName("C:\\code\\app"), "--C--code-app--");
});

test("编码有损：两个不同目录落进同一个会话目录", () => {
  assert.equal(sessionDirName("/work/shop"), sessionDirName("/work-shop"));
});

test("文件名来回转换", () => {
  const name = sessionFileName("2026-09-30T02:14:05.000Z", "0199a1c2-7f3c");
  assert.equal(name, "2026-09-30T02-14-05-000Z_0199a1c2-7f3c.jsonl");
  assert.deepEqual(parseSessionFileName(name), { startedAt: "2026-09-30T02:14:05.000Z", sessionId: "0199a1c2-7f3c" });
});

test("不像会话文件的名字返回 undefined", () => {
  for (const n of ["x.jsonl", "2026-09-30T02-14-05-000Z_.jsonl", "2026-09-30T02-14-05-000Z_../x.jsonl", "2026-09-30T02-14-05-000Z_a.json"]) {
    assert.equal(parseSessionFileName(n), undefined, n);
  }
});
