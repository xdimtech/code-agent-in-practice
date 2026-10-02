import assert from "node:assert/strict";
import { test } from "node:test";
import { makeAnchor, parseAnchor, serializeAnchor } from "./anchor.ts";
import { InputError } from "./types.ts";

const HASH = "a".repeat(64);

test("出锚点再读回来，内容不变", () => {
  const anchor = makeAnchor({ seq: 7, hash: HASH }, "2026-10-03T09:00:00.000Z");
  assert.deepEqual(parseAnchor(serializeAnchor(anchor)), anchor);
});

test("锚点格式不对一律 InputError，并带上来源", () => {
  for (const text of ["x", "[]", '{"seq":0,"hash":"aa","at":"2026"}', `{"seq":1,"hash":"${HASH}","at":"昨天"}`, `{"seq":1.5,"hash":"${HASH}","at":"2026-10-03"}`]) {
    assert.throws(() => parseAnchor(text, "a.json"), (e: unknown) => e instanceof InputError && e.message.startsWith("a.json"), text);
  }
});
