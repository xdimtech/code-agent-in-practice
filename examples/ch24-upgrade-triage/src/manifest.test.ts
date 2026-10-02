import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildManifest, InputError, pathExists, readText } from "./manifest.ts";

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ch24-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test("清单：相对路径、排好序、内容相同摘要相同", (t) => {
  const root = tree({ "src/b.ts": "x", "src/a.ts": "x", "README.md": "y", "node_modules/p/i.ts": "z", ".git/HEAD": "ref" });
  t.after(() => rmSync(root, { recursive: true }));
  const m = buildManifest(root);
  assert.deepEqual([...m.keys()], ["README.md", "src/a.ts", "src/b.ts"]);
  assert.equal(m.get("src/a.ts"), m.get("src/b.ts"));
  assert.notEqual(m.get("src/a.ts"), m.get("README.md"));
  assert.match(m.get("README.md") ?? "", /^[0-9a-f]{64}$/);
});

test("扩展名过滤", (t) => {
  const root = tree({ "a.ts": "1", "a.test.ts": "2", "b.json": "3" });
  t.after(() => rmSync(root, { recursive: true }));
  assert.deepEqual([...buildManifest(root, { extensions: [".json"] }).keys()], ["b.json"]);
});

test("不跟随符号链接", (t) => {
  const outside = tree({ "secret.ts": "s" });
  const root = tree({ "a.ts": "1" });
  t.after(() => [root, outside].forEach((d) => rmSync(d, { recursive: true })));
  symlinkSync(outside, join(root, "linked"));
  symlinkSync(join(outside, "secret.ts"), join(root, "s.ts"));
  assert.deepEqual([...buildManifest(root).keys()], ["a.ts"]);
});

test("文件数上限、不是目录、不存在", (t) => {
  const root = tree({ "a.ts": "1", "b.ts": "2" });
  t.after(() => rmSync(root, { recursive: true }));
  assert.throws(() => buildManifest(root, { maxFiles: 1 }), InputError);
  assert.throws(() => buildManifest(join(root, "a.ts")), /不是目录/);
  assert.throws(() => buildManifest(join(root, "nope")), /读不到/);
});

test("读文本与存在性", (t) => {
  const root = tree({ "a.md": "hello" });
  t.after(() => rmSync(root, { recursive: true }));
  assert.equal(readText(join(root, "a.md")), "hello");
  assert.throws(() => readText(root), /不是普通文件/);
  assert.equal(pathExists(join(root, "a.md")), true);
  assert.equal(pathExists(join(root, "b.md")), false);
});
