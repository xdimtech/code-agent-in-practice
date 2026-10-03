import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runBatch } from "../src/host.ts";
import { memFs } from "../src/memfs.ts";
import type { ToolDef } from "../src/types.ts";
import extension, { createExtension, nodeFs } from "./find-text.ts";

/** 一个假的 pi：只记下注册的工具。没有对真实的 pi 跑过 */
function fakePi() {
  const tools: ToolDef[] = [];
  return { tools, pi: { registerTool: (t: ToolDef) => void tools.push(t) } };
}

const dir = mkdtempSync(join(tmpdir(), "ch10-ext-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("工厂函数注册一个 find_text，参数 schema 是普通 JSON Schema", () => {
  const { tools, pi } = fakePi();
  extension(pi);
  assert.deepEqual(tools.map((t) => t.name), ["find_text"]);
  assert.equal(tools[0].parameters.type, "object");
  assert.equal(Object.getOwnPropertySymbols(tools[0].parameters).length, 0, "没有 TypeBox 的 Kind 符号");
});

test("可以换文件系统：测试里用内存目录", async () => {
  const { tools, pi } = fakePi();
  createExtension(memFs({ "/w/a.txt": "hello" }))(pi);
  const r = await runBatch({ tools, calls: [{ id: "1", name: "find_text", arguments: { pattern: "hello" } }], ctx: { cwd: "/w" } });
  assert.equal(r.messages[0].content[0].text, "a.txt:1:hello");
});

test("真实磁盘：lstat 不跟随符号链接，全文存到 0600 的临时文件", async () => {
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "// TODO one\n");
  writeFileSync(join(dir, "outside.txt"), "TODO outside\n");
  symlinkSync(join(dir, "outside.txt"), join(dir, "src", "link.txt"));
  assert.equal(nodeFs.stat(join(dir, "src", "link.txt"))?.kind, "other");
  assert.equal(nodeFs.stat(join(dir, "nope")), undefined);
  const { tools, pi } = fakePi();
  extension(pi);
  const r = await runBatch({ tools, calls: [{ id: "1", name: "find_text", arguments: { pattern: "TODO", path: "src" } }], ctx: { cwd: dir } });
  assert.equal(r.messages[0].content[0].text, "src/a.ts:1:// TODO one");
  const saved = nodeFs.saveFull("full");
  after(() => rmSync(join(saved, ".."), { recursive: true, force: true }));
  assert.equal(statSync(saved).mode & 0o777, 0o600);
  assert.equal(readFileSync(saved, "utf8"), "full");
});
