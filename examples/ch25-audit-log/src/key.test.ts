import assert from "node:assert/strict";
import { test } from "node:test";
import { KEY_ENV, keyFromEnv, MIN_KEY_BYTES } from "./key.ts";
import { InputError } from "./types.ts";

test("没设或设成空：不用密钥", () => {
  assert.equal(keyFromEnv({}), undefined);
  assert.equal(keyFromEnv({ [KEY_ENV]: "" }), undefined);
});

test("够长：按 UTF-8 字节作为密钥", () => {
  const raw = "k".repeat(MIN_KEY_BYTES);
  assert.deepEqual(keyFromEnv({ [KEY_ENV]: raw }), Buffer.from(raw));
});

test("太短：报错，不悄悄退回 sha256；报错里不出现密钥本身", () => {
  const raw = "short" + "-key";
  assert.throws(() => keyFromEnv({ [KEY_ENV]: raw }), (e: unknown) => e instanceof InputError && !e.message.includes(raw) && /至少要 32/.test(e.message));
});
