import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepIn, parseGrepOutput, repoRoot, RepoError } from "./probe.ts";

function fixtureRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("解析 git grep -z -n 的输出，文件名里的冒号不会切错", () => {
  assert.deepEqual(parseGrepOutput("a:b.ts\u00003\u0000  export x\nc.ts\u000010\u0000y\n"), [
    { file: "a:b.ts", line: 3, text: "export x" },
    { file: "c.ts", line: 10, text: "y" },
  ]);
  assert.deepEqual(parseGrepOutput(""), []);
});

test("只在 glob 范围内找，测试与 vendor 目录不算证据", (t) => {
  const dir = fixtureRepo({
    "packages/a/src/mcp.ts": "import { Client } from '@modelcontextprotocol/sdk';\n",
    "packages/a/src/mcp.test.ts": "McpClient\n",
    "packages/a/src/vendor/x.js": "McpClient\n",
    "docs/notes.md": "McpClient\n",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const grep = grepIn(repoRoot(dir));
  assert.deepEqual(
    grep({ pattern: "@modelcontextprotocol|McpClient", paths: ["**/src/**"] }).map((h) => `${h.file}:${h.line}`),
    ["packages/a/src/mcp.ts:1"],
  );
});

test("skip 目录里的命中不算——工具自己的清单不能当证据", (t) => {
  const dir = fixtureRepo({
    "src/agent.ts": "x\n",
    "tools/audit/src/manifest.ts": "pattern: 'McpClient'\n",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const probe = { pattern: "McpClient", paths: ["**/src/**"] };
  assert.equal(grepIn(dir)(probe).length, 1);
  assert.deepEqual(grepIn(dir, ["tools/audit"])(probe), []);
});

test("没有命中是正常结果（git grep 退出码 1），不是错误", (t) => {
  const dir = fixtureRepo({ "src/a.ts": "x\n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(grepIn(dir)({ pattern: "doctor", paths: ["**"] }), []);
});

test("ignoreCase 生效", (t) => {
  const dir = fixtureRepo({ "src/a.ts": "class SubAgent {}\n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const grep = grepIn(dir);
  assert.equal(grep({ pattern: "subagent", paths: ["**"] }).length, 0);
  assert.equal(grep({ pattern: "subagent", paths: ["**"], ignoreCase: true }).length, 1);
});

test("坏正则抛 RepoError，消息里带着探针", (t) => {
  const dir = fixtureRepo({ "src/a.ts": "x\n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => grepIn(dir)({ pattern: "(", paths: ["**"] }),
    (e) => e instanceof RepoError && /探针「\(」执行失败/.test(e.message),
  );
});

test("不存在的路径、普通文件、非 git 目录都给出明确错误", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  writeFileSync(join(dir, "f"), "");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => repoRoot(join(dir, "missing")), (e) => e instanceof RepoError && /不存在/.test(e.message));
  assert.throws(() => repoRoot(join(dir, "f")), (e) => e instanceof RepoError && /不是目录/.test(e.message));
  assert.throws(() => repoRoot(dir), (e) => e instanceof RepoError && /不在 git 仓库里/.test(e.message));
});
