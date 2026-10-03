import { strict as assert } from "node:assert";
import { test } from "node:test";

import { code, doc, formatEvidence, inference, measured, tagOf } from "../src/evidence.ts";

test("code 出处：行号区间必须是正整数且不倒置", () => {
	assert.throws(() => code("pi", "a.ts", 0, 1, "x"), /行号区间不合法/);
	assert.throws(() => code("pi", "a.ts", 5, 4, "x"), /行号区间不合法/);
	assert.throws(() => code("pi", "a.ts", 1.5, 2, "x"), /行号区间不合法/);
	assert.deepEqual(code("pi", "a.ts", 3, 3, "x").kind, "code");
});

test("code 出处：needle 不能是空白——空串在哪一行都找得到", () => {
	assert.throws(() => code("pi", "a.ts", 1, 1, "  "), /needle 不能是空的/);
});

test("doc 出处：只收 https，引文不能空", () => {
	assert.throws(() => doc("http://example.com", "q"), /https/);
	assert.throws(() => doc("https://example.com", ""), /引文不能是空的/);
	assert.equal(doc("https://example.com", "q").kind, "doc");
});

test("四种出处对应四个正文标签", () => {
	assert.equal(tagOf(code("pi", "a.ts", 1, 1, "x")), "代码事实");
	assert.equal(tagOf(doc("https://e.com", "q")), "文档");
	assert.equal(tagOf(measured("wc -l", "3")), "实机");
	assert.equal(tagOf(inference("因为")), "推断");
});

test("formatEvidence：单行不写区间，多行写区间", () => {
	assert.equal(formatEvidence(code("codex", "x.rs", 7, 7, "n")), "【代码事实】codex:x.rs:7");
	assert.equal(formatEvidence(code("codex", "x.rs", 7, 9, "n")), "【代码事实】codex:x.rs:7-9");
	assert.equal(formatEvidence(doc("https://e.com/a", "hello")), "【文档】https://e.com/a「hello」");
	assert.equal(formatEvidence(measured("wc -l f", "3")), "【实机】wc -l f → 3");
	assert.equal(formatEvidence(inference("推的")), "【推断】推的");
});
