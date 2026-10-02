import assert from "node:assert/strict";
import { test } from "node:test";
import { digest, hashInput, headOf, seal, serialize, signerFor } from "./chain.ts";
import { DEMO_KEY } from "./fixtures.ts";
import { GENESIS } from "./types.ts";

const SHA = signerFor(undefined);
const AT = "2026-10-03T09:00:00.000Z";

test("第一条接在 GENESIS 后面，序号从 1 开始", () => {
  const r = seal(undefined, { kind: "a", body: { x: 1 } }, AT, SHA);
  assert.equal(r.seq, 1);
  assert.equal(r.prev, GENESIS);
  assert.equal(r.alg, "sha256");
  assert.match(r.hash, /^[0-9a-f]{64}$/);
});

test("第二条的 prev 是第一条的 hash", () => {
  const a = seal(undefined, { kind: "a", body: 1 }, AT, SHA);
  const b = seal(headOf(a), { kind: "b", body: 2 }, AT, SHA);
  assert.equal(b.seq, 2);
  assert.equal(b.prev, a.hash);
});

test("hash 就是对去掉 hash 的记录求摘要", () => {
  const r = seal(undefined, { kind: "a", body: { k: "v" } }, AT, SHA);
  const { hash, ...rest } = r;
  assert.equal(digest(SHA, hashInput(rest)), hash);
});

test("同样的内容，sha256 和 HMAC 算出来不一样；HMAC 换了密钥也不一样", () => {
  const entry = { kind: "a", body: 1 };
  const plain = seal(undefined, entry, AT, SHA);
  const keyed = seal(undefined, entry, AT, signerFor(DEMO_KEY));
  const other = seal(undefined, entry, AT, signerFor(Buffer.from("x".repeat(32))));
  assert.equal(keyed.alg, "hmac-sha256");
  assert.notEqual(plain.hash, keyed.hash);
  assert.notEqual(keyed.hash, other.hash);
});

test("alg 在哈希输入里：只改 alg 字段，哈希输入就变了", () => {
  const r = seal(undefined, { kind: "a", body: 1 }, AT, SHA);
  const { hash: _hash, ...rest } = r;
  assert.notEqual(hashInput(rest), hashInput({ ...rest, alg: "hmac-sha256" }));
});

test("记录种类不合规直接报错", () => {
  assert.throws(() => seal(undefined, { kind: "Tool Call", body: 1 }, AT, SHA), /种类不合规/);
  assert.throws(() => seal(undefined, { kind: "", body: 1 }, AT, SHA), /种类不合规/);
});

test("body 被拷贝，之后改原对象不影响已封的记录", () => {
  const body = { command: "ls" };
  const r = seal(undefined, { kind: "a", body }, AT, SHA);
  body.command = "rm -rf /";
  assert.deepEqual(r.body, { command: "ls" });
});

test("serialize 一行一条，以换行结尾", () => {
  const text = serialize(seal(undefined, { kind: "a", body: 1 }, AT, SHA));
  assert.ok(text.endsWith("\n"));
  assert.equal(text.split("\n").length, 2);
});

test("hmac 没有密钥时拒绝计算", () => {
  assert.throws(() => digest({ alg: "hmac-sha256" }, "x"), /需要密钥/);
});
