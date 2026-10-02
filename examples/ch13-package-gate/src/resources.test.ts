import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPackageResources, enabledPaths } from "./resources.ts";
import { collectResourceFiles, expandGlob, listDir } from "./tree.ts";

const TREE = [
  "extensions/a.ts",
  "extensions/helper/index.ts",
  "extensions/helper/util.ts",
  "extensions/notes.md",
  "skills/intro.md",
  "skills/review/SKILL.md",
  "skills/review/checklist.md",
  "skills/group/deploy/SKILL.md",
  "skills/group/loose.md",
  "prompts/commit.md",
  "prompts/nested/fix.md",
  "themes/dark.json",
];

test("listDir 分出文件和子目录", () => {
  assert.deepEqual(listDir(TREE, "extensions"), { files: ["a.ts", "notes.md"], dirs: ["helper"] });
});

test("扩展：顶层 .ts/.js 加上有 index 的子目录", () => {
  assert.deepEqual(collectResourceFiles(TREE, "extensions", "extensions"), ["extensions/a.ts", "extensions/helper/index.ts"]);
});

test("扩展：目录自己有 index.ts 就只认它", () => {
  assert.deepEqual(collectResourceFiles(["extensions/index.ts", "extensions/b.ts"], "extensions", "extensions"), ["extensions/index.ts"]);
});

test("技能：SKILL.md 目录算一个且不再往下；只有根目录的 .md 算技能", () => {
  assert.deepEqual(collectResourceFiles(TREE, "skills", "skills"), ["skills/intro.md", "skills/group/deploy/SKILL.md", "skills/review/SKILL.md"]);
});

test("prompts 递归收 .md，themes 递归收 .json", () => {
  assert.deepEqual(collectResourceFiles(TREE, "prompts", "prompts"), ["prompts/commit.md", "prompts/nested/fix.md"]);
  assert.deepEqual(collectResourceFiles(TREE, "themes", "themes"), ["themes/dark.json"]);
});

test("glob 展开按字典序，也能命中目录", () => {
  assert.deepEqual(expandGlob(TREE, "./skills/*"), ["skills/group", "skills/intro.md", "skills/review"]);
});

test("没有清单：走约定目录", () => {
  const c = collectPackageResources(TREE, undefined);
  assert.equal(c.mode, "convention");
  assert.equal(enabledPaths(c.resources, "themes").length, 1);
});

test("有清单：只看清单，清单没写的类型一个也不加载", () => {
  const c = collectPackageResources(TREE, { skills: ["./skills/review"] });
  assert.equal(c.mode, "manifest");
  assert.deepEqual(enabledPaths(c.resources, "skills"), ["skills/review/SKILL.md"]);
  assert.deepEqual(enabledPaths(c.resources, "themes"), []);
});

test("空清单 {} 什么也不加载", () => {
  const c = collectPackageResources(TREE, {});
  assert.equal(c.resources.extensions.length + c.resources.skills.length + c.resources.prompts.length + c.resources.themes.length, 0);
});

test("清单里的 ! 在清单内部生效；不存在的条目进 unmatched", () => {
  const c = collectPackageResources(TREE, { prompts: ["./prompts", "!prompts/nested/*"], themes: ["./nope"] });
  assert.deepEqual(enabledPaths(c.resources, "prompts"), ["prompts/commit.md"]);
  assert.deepEqual(c.unmatched, ["pi.themes: ./nope"]);
});

test("过滤器没写的类型退回默认：清单没有这一类，就去看约定目录——资源变多", () => {
  const manifest = { extensions: ["./extensions"] };
  assert.deepEqual(enabledPaths(collectPackageResources(TREE, manifest).resources, "themes"), []);
  assert.deepEqual(enabledPaths(collectPackageResources(TREE, manifest, { extensions: ["!a.ts"] }).resources, "themes"), ["themes/dark.json"]);
});

test("过滤器写 [] 关掉整类，但文件仍登记为 disabled", () => {
  const c = collectPackageResources(TREE, undefined, { themes: [] });
  assert.deepEqual(c.resources.themes, [{ path: "themes/dark.json", enabled: false }]);
});

test("过滤器的模式作用在清单解析出的候选上", () => {
  const c = collectPackageResources(TREE, { prompts: ["./prompts"] }, { prompts: ["commit.md"] });
  assert.deepEqual(c.resources.prompts, [{ path: "prompts/commit.md", enabled: true }, { path: "prompts/nested/fix.md", enabled: false }]);
});

test("autoload: false 是差量：只给提到的文件定状态", () => {
  const c = collectPackageResources(TREE, undefined, { autoload: false, prompts: ["+prompts/commit.md", "!fix.md"] });
  assert.deepEqual(c.resources.prompts, [{ path: "prompts/commit.md", enabled: true }, { path: "prompts/nested/fix.md", enabled: false }]);
  assert.deepEqual(c.resources.themes, []);
});
