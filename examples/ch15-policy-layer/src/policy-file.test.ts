import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_POLICY_BYTES, readOverlay } from "./load.ts";
import { parseOverlay, parseOverlayText, PolicyFormatError } from "./policy-file.ts";

const fails = (value: unknown, pattern: RegExp) => assert.throws(() => parseOverlay(value), (e: unknown) => e instanceof PolicyFormatError && pattern.test(e.message));

test("合法的部分配置原样通过，没写的键不出现", () => {
  assert.deepEqual(parseOverlay({ mode: "read-only", protectedPaths: ["secrets/*"] }), { mode: "read-only", protectedPaths: ["secrets/*"] });
  assert.deepEqual(parseOverlay({}), {});
  assert.deepEqual(parseOverlay({ writeRoots: [], gateUserCommands: false }), { writeRoots: [], gateUserCommands: false });
});

test("顶层必须是对象", () => {
  for (const v of [null, [], "ask", 1]) fails(v, /JSON 对象/);
});

test("拼错的键报错，不悄悄忽略", () => {
  fails({ protectedPath: [".env"] }, /不认识的键：protectedPath/);
});

test("值的类型不对就报错", () => {
  fails({ mode: "yolo" }, /mode 只能是/);
  fails({ gateUserCommands: "false" }, /布尔值/);
  fails({ writeRoots: "." }, /writeRoots 必须是/);
  fails({ protectedPaths: [".env", 1] }, /protectedPaths 必须是/);
  fails({ protectedPaths: [""] }, /protectedPaths 必须是/);
});

test("文本解析：坏 JSON 和坏内容都带上文件名", () => {
  assert.throws(() => parseOverlayText("{", "a.json"), /a\.json 不是合法的 JSON/);
  assert.throws(() => parseOverlayText('{"mode":"x"}', "a.json"), /a\.json：mode 只能是/);
});

test("读文件：不存在、目录、符号链接、过大都拒绝", () => {
  const dir = mkdtempSync(join(tmpdir(), "ch15-policy-"));
  const good = join(dir, "good.json");
  writeFileSync(good, '{"mode":"read-only"}');
  assert.deepEqual(readOverlay(good), { mode: "read-only" });
  assert.throws(() => readOverlay(join(dir, "missing.json")), /找不到策略文件/);
  assert.throws(() => readOverlay(dir), /不是普通文件/);
  const link = join(dir, "link.json");
  symlinkSync(good, link);
  assert.throws(() => readOverlay(link), /不是普通文件/);
  const big = join(dir, "big.json");
  writeFileSync(big, " ".repeat(MAX_POLICY_BYTES + 1));
  assert.throws(() => readOverlay(big), /超过上限/);
});
