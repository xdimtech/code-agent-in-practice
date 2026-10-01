import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoError, weighRepo } from "./repo.ts";

function fixtureRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "weigh-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("只称 git 跟踪的源码，从子目录进入也称整个仓库", (t) => {
  const dir = fixtureRepo({
    "packages/a/src/x.ts": "1\n2\n3\n",
    "packages/a/src/x.test.ts": "1\n",
    "packages/b/src/y.tsx": "1\n",
    "packages/b/README.md": "1\n",
  });
  writeFileSync(join(dir, "packages/a/src/untracked.ts"), "1\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const weighed = weighRepo(join(dir, "packages/b"));
  assert.deepEqual(
    [...weighed.files].sort((p, q) => p.path.localeCompare(q.path)),
    [
      { path: "packages/a/src/x.ts", lines: 3 },
      { path: "packages/b/src/y.tsx", lines: 1 },
    ],
  );
  assert.deepEqual(weighed.unreadable, []);
});

test("跟踪了但工作区里没有的文件单独报告，不算进行数", (t) => {
  const dir = fixtureRepo({ "packages/a/src/x.ts": "1\n", "packages/a/src/gone.ts": "1\n" });
  rmSync(join(dir, "packages/a/src/gone.ts"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const weighed = weighRepo(dir);
  assert.deepEqual(weighed.files, [{ path: "packages/a/src/x.ts", lines: 1 }]);
  assert.deepEqual(weighed.unreadable, ["packages/a/src/gone.ts"]);
});

test("不存在的路径、普通文件、非 git 目录都给出明确错误", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "weigh-"));
  writeFileSync(join(dir, "f"), "");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => weighRepo(join(dir, "missing")), (e) => e instanceof RepoError && /不存在/.test(e.message));
  assert.throws(() => weighRepo(join(dir, "f")), (e) => e instanceof RepoError && /不是目录/.test(e.message));
  assert.throws(() => weighRepo(dir), (e) => e instanceof RepoError && /不在 git 仓库里/.test(e.message));
});
