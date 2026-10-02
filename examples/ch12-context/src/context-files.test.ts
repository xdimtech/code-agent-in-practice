import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContextFileFromDir, loadContextFiles, measureContextFiles } from "./context-files.ts";
import { CWD, DEMO_FS, HOME } from "./fixtures.ts";

test("同一目录只取第一个候选：override 遮住 AGENTS.md，AGENTS.md 遮住 CLAUDE.md，不合并", () => {
  assert.equal(loadContextFileFromDir(DEMO_FS, CWD)?.path, `${CWD}/AGENTS.override.md`);
  assert.equal(loadContextFileFromDir(DEMO_FS, "/work/shop")?.path, "/work/shop/AGENTS.md");
  assert.equal(loadContextFileFromDir(DEMO_FS, "/nowhere"), undefined);
});

test("顺序：全局在最前，然后从根到 cwd——越近的越靠后", () => {
  const paths = loadContextFiles({ fs: DEMO_FS, cwd: CWD, agentDir: `${HOME}/.pi/agent` }).map((f) => f.path);
  assert.deepEqual(paths, [`${HOME}/.pi/agent/AGENTS.md`, "/work/AGENTS.md", "/work/shop/AGENTS.md", `${CWD}/AGENTS.override.md`]);
});

test("走到文件系统根，不在 git 根停下：仓库外的 /work/AGENTS.md 也进来了", () => {
  const paths = loadContextFiles({ fs: DEMO_FS, cwd: "/work/shop", agentDir: "/none" }).map((f) => f.path);
  assert.deepEqual(paths, ["/work/AGENTS.md", "/work/shop/AGENTS.md"]);
});

test("全局目录恰好是祖先目录时只收一次", () => {
  const fs = new Map([["/a/AGENTS.md", "x"]]);
  assert.equal(loadContextFiles({ fs, cwd: "/a/b", agentDir: "/a" }).length, 1);
});

test("去掉 BOM", () => {
  const fs = new Map([["/AGENTS.md", "\ufeff# 标题"]]);
  assert.equal(loadContextFiles({ fs, cwd: "/", agentDir: "/none" })[0]?.content, "# 标题");
});

test("预算：按 4 字符 1 token 粗估，超出就标出来", () => {
  const files = [{ path: "/a", content: "x".repeat(4_000) }, { path: "/b", content: "y".repeat(401) }];
  const budget = measureContextFiles(files, 1_000);
  assert.deepEqual(budget.perFile.map((f) => f.tokens), [1_000, 101]);
  assert.equal(budget.overBudget, true);
});
