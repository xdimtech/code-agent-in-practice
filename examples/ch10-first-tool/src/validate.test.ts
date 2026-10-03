import assert from "node:assert/strict";
import { test } from "node:test";
import type { Schema } from "./types.ts";
import { check, coerce, dropOptionalNulls, validateArguments } from "./validate.ts";

const schema: Schema = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    limit: { type: "integer", minimum: 1 },
    deep: { type: "boolean" },
    mode: { type: "string", enum: ["a", "b"] },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["pattern"],
  additionalProperties: false,
};

test("可选字段的 null 删掉，必填字段的 null 留下", () => {
  assert.deepEqual(dropOptionalNulls({ pattern: null, limit: null }, schema), { pattern: null });
});

test("标量转换：数字串、布尔串、数字转字符串、null 转零值", () => {
  assert.deepEqual(coerce({ pattern: 42, limit: "10", deep: "true", tags: [1, true] }, schema), { pattern: "42", limit: 10, deep: true, tags: ["1", "true"] });
  assert.deepEqual(coerce({ limit: "1.5", deep: "yes" }, schema), { limit: "1.5", deep: "yes" });
  assert.equal(coerce(null, { type: "boolean" }), false);
  assert.equal(coerce(0, { type: "boolean" }), false);
  assert.equal(coerce("", { type: "number" }), "");
});

test("必填的 null 转成空串：能过类型检查，这是转换的副作用", () => {
  assert.deepEqual(validateArguments("t", schema, { pattern: null }), { pattern: "" });
});

test("检查：缺字段、多字段、类型、枚举、下限，路径用点号", () => {
  const issues = check({ limit: 0, mode: "c", extra: 1, tags: ["x", 2] }, schema);
  assert.deepEqual(issues, [
    { path: "pattern", message: "is required" },
    { path: "extra", message: "is not allowed (additionalProperties: false)" },
    { path: "limit", message: "must be >= 1" },
    { path: "mode", message: "must be one of a, b" },
    { path: "tags.1", message: "must be string" },
  ]);
  assert.deepEqual(check("x", schema), [{ path: "", message: "must be object" }]);
});

test("错误消息照 pi 的格式：工具名、逐条问题、原始参数", () => {
  assert.throws(
    () => validateArguments("find_text", schema, "oops"),
    (e: Error) => e.message === 'Validation failed for tool "find_text":\n  - root: must be object\n\nReceived arguments:\n"oops"',
  );
});

test("不改传入的参数", () => {
  const raw = { pattern: "x", limit: "3", deep: null };
  const frozen = structuredClone(raw);
  assert.deepEqual(validateArguments("t", schema, raw), { pattern: "x", limit: 3 });
  assert.deepEqual(raw, frozen);
});
