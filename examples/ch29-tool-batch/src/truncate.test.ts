import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceUnpairedSurrogates, tailBytes, utf8Length } from "./truncate.ts";

test("不会把 emoji 切成两半：预算不够就整个丢掉", () => {
  assert.equal(tailBytes("a😀", 3), "");
  assert.equal(tailBytes("a😀", 4), "😀");
  assert.equal(tailBytes("a😀", 5), "a😀");
});

test("汉字按 3 字节计", () => {
  assert.equal(tailBytes("中文", 3), "文");
  assert.equal(tailBytes("中文", 5), "文");
  assert.equal(tailBytes("中文", 6), "中文");
});

test("落单的代理项被替换成 U+FFFD，字节数不超预算", () => {
  const lone = "x\uD83D";
  const out = tailBytes(lone, 3);
  assert.equal(out, "�");
  assert.ok(utf8Length(out) <= 3);
});

test("成对的代理项保持不变", () => {
  assert.equal(replaceUnpairedSurrogates("ok 🙈"), "ok 🙈");
  assert.equal(replaceUnpairedSurrogates("a\uDE00b"), "a�b");
});

test("任意预算下结果都不超过预算", () => {
  const text = "日志：✅ 通过 😀😀 done\uD83D";
  for (let max = 0; max <= utf8Length(text) + 2; max++) {
    assert.ok(utf8Length(tailBytes(text, max)) <= max, `max=${max}`);
  }
});
