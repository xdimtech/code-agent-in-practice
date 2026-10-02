import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "main.ts"), ...args], { encoding: "utf8" });

test("演示跑完五段", () => {
  const out = run();
  assert.equal(out.status, 0, out.stderr);
  for (const n of [1, 2, 3, 4, 5]) assert.match(out.stdout, new RegExp(`== ${n}\\. `));
  assert.match(out.stdout, /拦下：sneaky-pack@0\.3\.1/);
  assert.match(out.stdout, /白名单过期：node-pty@1\.0\.0/);
});

test("检查整洁的包：有中等问题但不阻断，退出码 0", () => {
  const out = run(join(here, "..", "demo", "review-pack"));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /review-pack@1\.2\.0/);
});

test("检查带安装脚本的包：退出码 1", () => {
  const out = run(join(here, "..", "demo", "sneaky-pack"), "--git");
  assert.equal(out.status, 1);
  assert.match(out.stdout, /prepare/);
});

test("目录不存在或没有 package.json：退出码 2", () => {
  assert.equal(run("/no/such/dir").status, 2);
  const empty = mkdtempSync(join(tmpdir(), "ch13-"));
  try {
    const out = run(empty);
    assert.equal(out.status, 2);
    assert.match(out.stderr, /package\.json/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("不跟随符号链接，跳过点开头的目录", () => {
  const root = mkdtempSync(join(tmpdir(), "ch13-"));
  try {
    const pkg = join(root, "pkg");
    mkdirSync(join(pkg, "skills", "a"), { recursive: true });
    mkdirSync(join(pkg, ".hidden"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "p", keywords: ["pi-package"] }));
    writeFileSync(join(pkg, "skills", "a", "SKILL.md"), "---\nname: a\n---\n");
    writeFileSync(join(pkg, ".hidden", "x.ts"), "");
    symlinkSync(root, join(pkg, "loop"));
    const out = run(pkg);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /skills 1/);
    assert.match(out.stdout, /没有发现问题/);
    assert.equal(run(join(pkg, "loop")).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
