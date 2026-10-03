import assert from "node:assert/strict";
import { test } from "node:test";
import { LS, PS } from "./fixtures.ts";
import { createLineReader, serializeLine, splitGeneric, splitStrict, takeLines, takeLinesGeneric } from "./jsonl.ts";

const collect = (max?: number) => {
  const lines: string[] = [];
  const oversize: number[] = [];
  const reader = createLineReader({ onLine: (l) => lines.push(l), onOversize: (b) => oversize.push(b) }, max);
  return { reader, lines, oversize };
};

test("serializeLine：一行一个 JSON，以 \\n 结尾；U+2028 不转义", () => {
  const line = serializeLine({ t: `a${LS}b` });
  assert.ok(line.endsWith("\n"));
  assert.ok(line.includes(LS));
  assert.equal(line.split("\n").length, 2);
});

test("takeLines：只按 \\n 切，去掉行尾 \\r，半行留下", () => {
  assert.deepEqual(takeLines('{"a":1}\r\n{"b":2}\n{"c"'), { lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
});

test("splitStrict：末尾没有换行的最后一行也算", () => {
  assert.deepEqual(splitStrict("a\nb"), ["a", "b"]);
  assert.deepEqual(splitStrict("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitStrict(""), []);
});

test("U+2028 / U+2029：严格分帧当内容，通用分行器当换行", () => {
  const text = serializeLine({ t: `一${LS}二${PS}三` });
  assert.equal(splitStrict(text).length, 1);
  assert.doesNotThrow(() => JSON.parse(splitStrict(text)[0]));
  const generic = splitGeneric(text);
  assert.equal(generic.length, 3);
  for (const piece of generic) assert.throws(() => JSON.parse(piece));
});

test("takeLinesGeneric：\\r 单独出现也会被切开", () => {
  assert.deepEqual(takeLinesGeneric("a\rb\nc").lines, ["a", "b"]);
});

test("流式：一个多字节字符被切成两块也能拼回来", () => {
  const { reader, lines } = collect();
  const bytes = Buffer.from(serializeLine({ t: "中文" }), "utf8");
  const cut = bytes.indexOf(Buffer.from("中", "utf8")) + 1;
  reader.push(bytes.subarray(0, cut));
  reader.push(bytes.subarray(cut));
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ t: "中文" }]);
});

test("流式：end() 把最后没有换行的一行交出来，并去掉 \\r", () => {
  const { reader, lines } = collect();
  reader.push('{"a":1}\n{"b":2}\r');
  assert.equal(lines.length, 1);
  reader.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("流式：半行超过上限就报一次 oversize，之后不再吐行", () => {
  const { reader, lines, oversize } = collect(16);
  reader.push("x".repeat(20));
  reader.push("\n{}\n");
  reader.end();
  assert.equal(oversize.length, 1);
  assert.ok(oversize[0] > 16);
  assert.deepEqual(lines, []);
});

test("流式：完整的长行不算 oversize（上限只管还没等到换行的半行）", () => {
  const { reader, lines, oversize } = collect(16);
  reader.push(`${"y".repeat(40)}\n`);
  assert.deepEqual(oversize, []);
  assert.equal(lines.length, 1);
});
