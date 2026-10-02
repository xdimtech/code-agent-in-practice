import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, user } from "./fixtures.ts";
import { REDACTED, redactEntries, redactString } from "./redact.ts";
import type { Entry } from "./types.ts";

// 假密钥一律拼出来，免得仓库的密钥扫描把测试本身当成泄漏
const SK = "s" + "k-" + "Ab3".repeat(8);
const GH = "gh" + "p_" + "Z9y".repeat(10);
const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const PEM = ["-----BEGIN RSA PRIVATE", "KEY-----\nMIIB\n-----END RSA PRIVATE", "KEY-----"].join(" ");

test("常见格式都遮掉，并计数", () => {
  for (const s of [SK, GH, AWS, `Authorization: Bearer ${"t".repeat(24)}`, PEM]) {
    const r = redactString(`x ${s} y`);
    assert.equal(r.secrets, 1, s);
    assert.ok(r.value.includes(REDACTED), s);
    assert.ok(!r.value.includes(s.slice(4, 12)) || s.startsWith("Authorization"), s);
  }
});

test("NAME=value：变量名带 KEY/TOKEN/SECRET/PASSWORD 的值遮掉，变量名留着", () => {
  assert.equal(redactString("DB_PASSWORD=hunter2 npm start").value, `DB_PASSWORD=${REDACTED} npm start`);
  assert.equal(redactString(`GH_TOKEN='abc def' x`).value, `GH_TOKEN=${REDACTED} x`);
  assert.equal(redactString("NODE_ENV=production").secrets, 0);
});

test("变量赋值里的 sk- 只算一处", () => {
  const r = redactString(`OPENAI_API_KEY=${SK} npm test`);
  assert.equal(r.secrets, 1);
  assert.equal(r.value, `OPENAI_API_KEY=${REDACTED} npm test`);
});

test("redactEntries：深层字段、图片，返回新数组，原数组不变，树结构不变", () => {
  const withCall = assistant("b", "a", { calls: [{ id: "t", name: "bash", args: { command: `X_SECRET=${SK} run`, nested: { k: GH } } }] });
  const withImage: Entry = { ...user("c", "b"), message: { role: "user", content: [{ type: "image", data: "QUJD".repeat(5), mimeType: "image/png" }], timestamp: 0 } };
  const input = [user("a", null), withCall, withImage];
  const snapshot = JSON.stringify(input);
  const { entries, stats } = redactEntries(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(stats, { secrets: 2, images: 1, imageBytes: 20 });
  assert.deepEqual(entries.map((e) => [e.id, e.parentId]), input.map((e) => [e.id, e.parentId]));
  const text = JSON.stringify(entries);
  assert.ok(!text.includes(SK) && !text.includes(GH));
  assert.match(text, /图片已移除：20 字节/);
});
