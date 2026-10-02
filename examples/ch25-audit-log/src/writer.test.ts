import assert from "node:assert/strict";
import { test } from "node:test";
import { signerFor } from "./chain.ts";
import { memoryIo } from "./fake-pi.ts";
import { at, DEMO_KEY, ENTRIES } from "./fixtures.ts";
import { buildLog, editLine } from "./forge.ts";
import { passed, verifyLog } from "./verify.ts";
import { openAuditWriter } from "./writer.ts";

const entry = { kind: "note", body: { n: 1 } };

test("新日志：从第 1 条写起，写出来的东西能通过校验", () => {
  const io = memoryIo();
  const w = openAuditWriter({ io, now: () => at(0) });
  w.append(entry);
  w.append(entry);
  assert.equal(w.head()?.seq, 2);
  assert.ok(passed(verifyLog(io.text())));
});

test("已有日志：接在链尾后面", () => {
  const { text, records } = buildLog(ENTRIES, signerFor(DEMO_KEY), at);
  const io = memoryIo(text);
  const w = openAuditWriter({ io, key: DEMO_KEY, now: () => at(50) });
  assert.deepEqual(w.head(), { seq: records.length, hash: records[records.length - 1].hash });
  const r = w.append(entry);
  assert.equal(r?.seq, records.length + 1);
  assert.equal(verifyLog(io.text(), { key: DEMO_KEY }).records.length, records.length + 1);
});

test("已有日志校验不过：拒绝往后写，原因里带行号和规则", () => {
  const { text } = buildLog(ENTRIES, signerFor(undefined), at);
  const io = memoryIo(editLine(text, 3, (l) => l.replace("git status", "git push")));
  const w = openAuditWriter({ io, now: () => at(50) });
  assert.match(w.degraded() ?? "", /第 3 行 hash-mismatch/);
  assert.equal(w.append(entry), undefined);
  assert.ok(!io.text().includes('"kind":"note"'));
});

test("已有 HMAC 日志、现在没有密钥：拒绝往后接 sha256 记录", () => {
  const { text } = buildLog(ENTRIES, signerFor(DEMO_KEY), at);
  assert.match(openAuditWriter({ io: memoryIo(text), now: () => at(50) }).degraded() ?? "", /没有密钥/);
});

test("已有日志用错的密钥打开：校验不过", () => {
  const { text } = buildLog(ENTRIES, signerFor(DEMO_KEY), at);
  assert.match(openAuditWriter({ io: memoryIo(text), key: Buffer.from("k".repeat(32)), now: () => at(50) }).degraded() ?? "", /hash-mismatch/);
});

test("写失败一次就降级，之后不再写，链尾停在最后一次成功", () => {
  const io = memoryIo("", 1);
  const w = openAuditWriter({ io, now: () => at(0) });
  assert.ok(w.append(entry));
  assert.equal(w.append(entry), undefined);
  assert.match(w.degraded() ?? "", /ENOSPC/);
  assert.equal(w.head()?.seq, 1);
  assert.ok(passed(verifyLog(io.text())));
});

test("读已有日志就抛错：降级", () => {
  const w = openAuditWriter({ io: { read: () => { throw new Error("EACCES"); }, append: () => undefined }, now: () => at(0) });
  assert.match(w.degraded() ?? "", /读不了已有日志：EACCES/);
});

test("内容拼不出来（NaN）也降级，而不是写一条坏记录", () => {
  const io = memoryIo();
  const w = openAuditWriter({ io, now: () => at(0) });
  assert.equal(w.append({ kind: "note", body: { n: Number.NaN } as never }), undefined);
  assert.match(w.degraded() ?? "", /不是有限数/);
  assert.equal(io.text(), "");
});
