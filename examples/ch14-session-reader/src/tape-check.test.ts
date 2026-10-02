import assert from "node:assert/strict";
import { test } from "node:test";
import { compaction, user } from "./fixtures.ts";
import type { RequestRecord, ResponseRecord } from "./recorder.ts";
import type { Exchange } from "./tape.ts";
import { tapeFindings } from "./tape-check.ts";

const request = (seq: number, o: Partial<RequestRecord> = {}): RequestRecord => ({ kind: "request", seq, at: "t", sessionId: "s-1", leafId: "u1", fingerprint: "f", redactedSecrets: 0, payload: {}, ...o });
const response = (seq: number, status: number): ResponseRecord => ({ kind: "response", seq, at: "t", status, headers: {} });
const codes = (xs: readonly { code: string }[]) => xs.map((x) => x.code);

test("干净的磁带没有发现", () => {
  const tape: Exchange[] = [{ request: request(1), response: response(1, 200) }];
  assert.deepEqual(tapeFindings(tape, [user("u1", null)], "s-1"), []);
});

test("别的会话、对不上的叶子、没响应头、错误状态", () => {
  const tape: Exchange[] = [
    { request: request(1, { sessionId: "other" }), response: response(1, 200) },
    { request: request(2, { leafId: "ghost" }), response: response(2, 200) },
    { request: request(3) },
    { request: request(4), response: response(4, 529) },
  ];
  const fs = tapeFindings(tape, [user("u1", null)], "s-1");
  assert.deepEqual(codes(fs), ["tape:foreign", "tape:unknown-leaf", "tape:no-response", "tape:status"]);
  assert.equal(fs[0]!.severity, "高");
  assert.match(fs[3]!.message, /529/);
});

test("会话里有花了钱的摘要，提示磁带里没有；遮掉的密钥计数", () => {
  const entries = [user("u1", null), compaction("c1", "u1", "u1", 0.002), compaction("c2", "c1", "u1")];
  const fs = tapeFindings([{ request: request(1, { redactedSecrets: 2 }), response: response(1, 200) }], entries, "s-1");
  assert.deepEqual(codes(fs), ["tape:summaries", "tape:redacted"]);
  assert.match(fs[0]!.message, /1 次摘要请求/);
  assert.match(fs[1]!.message, /2 处密钥/);
});
