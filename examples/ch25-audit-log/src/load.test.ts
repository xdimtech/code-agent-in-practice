import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileDigest, fileIo, readRegular } from "./load.ts";
import { InputError } from "./types.ts";

const dir = mkdtempSync(join(tmpdir(), "ch25-load-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const unix = process.platform !== "win32";

test("fileIo：文件不存在读出 undefined；追加时用 0600 创建", () => {
  const path = join(dir, "audit.jsonl");
  const io = fileIo(path);
  assert.equal(io.read(), undefined);
  io.append("a\n");
  io.append("b\n");
  assert.equal(io.read(), "a\nb\n");
  if (unix) assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("fileIo：组或其他用户可写的日志不接着写", { skip: !unix }, () => {
  const path = join(dir, "shared.jsonl");
  writeFileSync(path, "");
  chmodSync(path, 0o666);
  assert.throws(() => fileIo(path).read(), /组或其他用户可写/);
});

test("符号链接不跟随", { skip: !unix }, () => {
  const real = join(dir, "real.jsonl");
  const link = join(dir, "link.jsonl");
  writeFileSync(real, "x");
  symlinkSync(real, link);
  assert.throws(() => readRegular(link, 1024), (e: unknown) => e instanceof InputError && /符号链接/.test(e.message));
  assert.throws(() => fileIo(link).read(), /符号链接/);
});

test("超过上限报错；找不到给出清楚的 InputError", () => {
  const big = join(dir, "big.txt");
  writeFileSync(big, "x".repeat(100));
  assert.throws(() => readRegular(big, 10), /超过上限/);
  assert.throws(() => readRegular(join(dir, "none"), 10), (e: unknown) => e instanceof InputError && /找不到/.test(e.message));
});

test("fileDigest：算出字节数和 sha256；文件不在了记原因", () => {
  const path = join(dir, "out.log");
  writeFileSync(path, "hello");
  assert.deepEqual(fileDigest(path), { bytes: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
  assert.deepEqual(fileDigest(join(dir, "gone.log")), { error: "文件已经不在了" });
});
