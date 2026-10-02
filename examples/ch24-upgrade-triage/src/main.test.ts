import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHANGELOG, LEDGER, VENDOR_MARKER } from "./fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ch24-main-"));
const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "main.ts"), ...args], { cwd: dir, encoding: "utf8" });
const file = (name: string, content: string): string => {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

test("不带参数跑演示，六段都在", () => {
  const r = run();
  assert.equal(r.status, 0);
  for (const head of ["一、", "二、", "三、", "四、", "五、", "六、"]) assert.ok(r.stdout.includes(`\n${head}`), head);
  assert.match(r.stdout, /只动了补丁号、却带破坏性变更的：0\.8\.2→0\.8\.3/);
  assert.match(r.stdout, /packages\/ui\/src\/keys\.ts 和基线不一样/);
});

test("changelog：区间里有破坏性变更退出 1，没有退出 0", () => {
  const path = file("CHANGELOG.md", CHANGELOG);
  const r = run("changelog", path, "--from", "0.8.0", "--to", "0.9.1");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /5 个版本，其中 2 个带破坏性变更，共 3 条/);
  assert.equal(run("changelog", path, "--from", "0.9.0").status, 0);
  assert.equal(run("changelog", path, "--from", "最新").status, 2);
  const mixed = file("MIXED.md", "## [1.1.0] - 2026-01-02\n\n### Breaking\n\n- a\n\n## [1.0.0] - 2026-01-01\n\n### Breaking Changes\n\n- b\n");
  assert.match(run("changelog", mixed).stdout, /标题有 2 种写法：「Breaking」1 次，「Breaking Changes」1 次/);
});

test("ledger：格式有错退出 1", () => {
  const r = run("ledger", file("LOCAL_CHANGES.md", LEDGER));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /上游 PR：not-opened 4/);
  assert.match(r.stdout, /\[heading-level\] 第 23 行/);
});

test("vendor：引用按标记文件所在目录解析", () => {
  const marker = file("vendor/acme/.vendor.json", VENDOR_MARKER);
  file("vendor/acme/LOCAL_CHANGES.md", "x");
  assert.match(run("vendor", marker).stdout, /\[dangling-reference\] policy 指向 \.\.\/AGENTS\.md/);
  file("vendor/AGENTS.md", "x");
  assert.equal(run("vendor", marker).status, 0);
});

test("triage：三个目录 + 台账，目录改名和原样挪走都能跟上", () => {
  file("t/base/ai/src/a.ts", "a0");
  file("t/base/ai/src/b.ts", "b0");
  file("t/base/ai/src/c.ts", "c0");
  file("t/base/ai/src/d.md", "d0");
  file("t/ours/providers/src/a.ts", "a-ours");
  file("t/ours/providers/src/b.ts", "b0");
  file("t/ours/providers/lib/c.ts", "c0");
  file("t/next/ai/src/a.ts", "a1");
  file("t/next/ai/src/b.ts", "b1");
  file("t/next/ai/src/c.ts", "c1");
  const dirs = ["--base", join(dir, "t/base"), "--ours", join(dir, "t/ours"), "--next", join(dir, "t/next"), "--ext", ".ts"];
  const naive = run("triage", ...dirs);
  assert.equal(naive.status, 1);
  assert.match(naive.stdout, /3 {4}ours-deleted-upstream-changed/);
  const mapped = run("triage", ...dirs, "--map", "ai=providers", "--follow-moves");
  assert.match(mapped.stdout, /原样挪走、已挪回去比对的文件：1 个/);
  assert.match(mapped.stdout, /2 {4}take-upstream/);
  assert.match(mapped.stdout, /合计 3 个路径，要人看的 1 个/);
  const ledger = file("t/L.md", "### 2026-08-01 — 改 a\n\n- Reason: r\n- Affected package: `ai`\n- Files: ai/src/a.ts\n- Change type: generic\n- Upstream PR: not opened.\n- Validation: v\n");
  assert.match(run("triage", ...dirs, "--map", "ai=providers", "--follow-moves", "--ledger", ledger).stdout, /要重做 {6}2026-08-01 {2}改 a（1 个文件）/);
});

test("用法错误退出 2，不打堆栈", () => {
  for (const args of [["nope"], ["ledger"], ["triage", "--base", dir], ["triage", "--base"], ["ledger", join(dir, "没有.md")], ["triage", "--base", dir, "--ours", dir, "--next", dir, "--map", "a"]]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /^错误：/);
    assert.doesNotMatch(r.stderr, /at .*main\.ts/);
  }
});
