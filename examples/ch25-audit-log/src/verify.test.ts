import assert from "node:assert/strict";
import { test } from "node:test";
import { makeAnchor } from "./anchor.ts";
import { canonicalJson } from "./canonical.ts";
import { signerFor } from "./chain.ts";
import { at, DEMO_KEY, ENTRIES, OTHER_KEY } from "./fixtures.ts";
import { buildLog, dropLine, dropTail, editLine, reseal } from "./forge.ts";
import { passed, verifyLog } from "./verify.ts";

const SHA = signerFor(undefined);
const HMAC = signerFor(DEMO_KEY);
const plain = buildLog(ENTRIES, SHA, at);
const keyed = buildLog(ENTRIES, HMAC, at);
const rules = (text: string, opts = {}) => verifyLog(text, opts).findings.map((f) => f.rule);
const tailAnchor = makeAnchor(plain.records[plain.records.length - 1], at(99));

test("原样的 sha256 链通过，只有一条说明", () => {
  const v = verifyLog(plain.text);
  assert.ok(passed(v));
  assert.equal(v.records.length, ENTRIES.length);
  assert.deepEqual(v.head, { seq: 7, hash: plain.records[6].hash });
  assert.deepEqual(rules(plain.text), ["unkeyed"]);
});

test("原样的 HMAC 链用对的密钥通过，没有任何发现", () => {
  assert.deepEqual(rules(keyed.text, { key: DEMO_KEY }), []);
});

test("改一行内容：这一行 hash-mismatch，之后都不可信", () => {
  const v = verifyLog(editLine(plain.text, 5, (l) => l.replace("rm -rf build", "ls build")));
  assert.equal(v.brokenAt, 5);
  assert.equal(v.records.length, 4);
  assert.deepEqual(v.findings.slice(0, 2).map((f) => f.rule), ["hash-mismatch", "untrusted-from"]);
  assert.match(v.findings[1].message, /后面 2 行没有再查/);
});

test("改了格式（多空格、换键序）也算断：只认写入器写出的样子", () => {
  const spaced = editLine(plain.text, 2, (l) => JSON.stringify(JSON.parse(l), null, 0).replace('"seq":2', '"seq": 2'));
  assert.equal(verifyLog(spaced).findings[0].rule, "non-canonical");
});

test("删中间一行：下一行 seq 对不上", () => {
  const v = verifyLog(dropLine(plain.text, 3));
  assert.equal(v.findings[0].rule, "seq-gap");
  assert.equal(v.brokenAt, 3);
});

test("交换两行：seq 对不上", () => {
  const ls = plain.text.trim().split("\n");
  const swapped = [ls[0], ls[2], ls[1], ...ls.slice(3)].map((l) => `${l}\n`).join("");
  assert.equal(verifyLog(swapped).findings[0].rule, "seq-gap");
});

test("按规范格式重写一条、seq 和 prev 都保持原样：hash 还是对不上", () => {
  const forged = editLine(plain.text, 4, (l) => canonicalJson({ ...(JSON.parse(l) as object), body: { toolCallId: "c2", toolName: "bash", args: { command: "ls" } } }));
  const v = verifyLog(forged);
  assert.equal(v.findings[0].rule, "hash-mismatch");
  assert.equal(v.brokenAt, 4);
});

test("删末尾：没有锚点照样通过；有锚点报 anchor-beyond-tail", () => {
  const cut = dropTail(plain.text, 2);
  assert.ok(passed(verifyLog(cut)));
  const v = verifyLog(cut, { anchor: tailAnchor });
  assert.ok(!passed(v));
  assert.ok(v.findings.some((f) => f.rule === "anchor-beyond-tail"));
});

test("sha256 链改完重算：不带锚点通过，带锚点 anchor-mismatch", () => {
  const forged = reseal(plain.records, 5, { changed: true }, SHA);
  assert.ok(passed(verifyLog(forged)));
  assert.deepEqual(rules(forged, { anchor: tailAnchor }), ["anchor-mismatch", "unkeyed"]);
});

test("HMAC 链用别的密钥重算：真密钥查出来，没有密钥查不出来", () => {
  const forged = reseal(keyed.records, 5, { changed: true }, signerFor(OTHER_KEY));
  assert.equal(verifyLog(forged, { key: DEMO_KEY }).brokenAt, 5);
  const blind = verifyLog(forged);
  assert.ok(passed(blind));
  assert.deepEqual(blind.findings.map((f) => f.rule), ["missing-key"]);
});

test("有密钥时混进 sha256 记录：alg-mismatch", () => {
  const forged = reseal(keyed.records, 5, { changed: true }, SHA);
  const v = verifyLog(forged, { key: DEMO_KEY });
  assert.equal(v.findings[0].rule, "alg-mismatch");
  assert.equal(v.brokenAt, 5);
});

test("最后一行没写完：trailing-partial，前面的仍然可信", () => {
  const v = verifyLog(`${plain.text}{"v":1,"seq":8`);
  assert.equal(v.findings[0].rule, "trailing-partial");
  assert.equal(v.records.length, 7);
  assert.equal(v.brokenAt, 8);
});

test("坏 JSON、坏形状各有各的规则名", () => {
  assert.equal(verifyLog("not json\n").findings[0].rule, "bad-json");
  assert.equal(verifyLog('{"v":1}\n').findings[0].rule, "bad-shape");
  assert.equal(verifyLog("[1]\n").findings[0].rule, "bad-shape");
});

test("空日志只给提醒", () => {
  const v = verifyLog("");
  assert.ok(passed(v));
  assert.deepEqual(v.findings.map((f) => f.rule), ["empty"]);
  assert.equal(v.head, undefined);
});

test("锚点在链中间且吻合：通过，并说明锚点之后还有几条", () => {
  const mid = makeAnchor(plain.records[3], at(99));
  const v = verifyLog(plain.text, { anchor: mid });
  assert.ok(passed(v));
  assert.match(v.findings.find((f) => f.rule === "after-anchor")?.message ?? "", /还有 3 条/);
});
