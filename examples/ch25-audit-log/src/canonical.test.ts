import assert from "node:assert/strict";
import { test } from "node:test";
import { CanonicalError, canonicalJson, toJson } from "./canonical.ts";

test("键按字典序、没有空白，嵌套也一样", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, "x"], c: null } }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
});

test("同一份内容，键的插入顺序不同，结果一样", () => {
  assert.equal(canonicalJson({ x: 1, y: 2 }), canonicalJson({ y: 2, x: 1 }));
});

test("undefined 值的键当作不存在，和 JSON.stringify 一致", () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test("拒绝 JSON 表示不了的值，并指出路径", () => {
  assert.throws(() => canonicalJson({ a: [1, Number.NaN] }), (e: unknown) => e instanceof CanonicalError && /\$\.a\[1\]/.test(e.message));
  assert.throws(() => canonicalJson({ a: Number.POSITIVE_INFINITY }), CanonicalError);
  assert.throws(() => canonicalJson({ a: 1n }), CanonicalError);
  assert.throws(() => canonicalJson({ a: new Date(0) }), /不是普通对象/);
  assert.throws(() => canonicalJson(() => 1), CanonicalError);
});

test("toJson 深拷贝：改原对象不影响结果", () => {
  const src = { a: { b: 1 } };
  const copy = toJson(src) as { a: { b: number } };
  src.a.b = 2;
  assert.equal(copy.a.b, 1);
});

test("null 原型的对象可以序列化", () => {
  const o = Object.assign(Object.create(null) as Record<string, unknown>, { k: "v" });
  assert.equal(canonicalJson(o), '{"k":"v"}');
});
