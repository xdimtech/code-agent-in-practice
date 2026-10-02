import assert from "node:assert/strict";
import { test } from "node:test";
import { hasBlocking, inspectPackage, type SourceKind } from "./inspect.ts";
import { parsePackageJson } from "./package-json.ts";
import { collectPackageResources } from "./resources.ts";
import type { FileTree } from "./tree.ts";

function inspect(pkg: object, tree: FileTree, source: SourceKind = "npm") {
  const parsed = parsePackageJson(JSON.stringify(pkg));
  return inspectPackage(parsed, tree, collectPackageResources(tree, parsed.pkg.pi), source);
}

const codes = (findings: ReturnType<typeof inspect>) => findings.map((f) => f.code);
const TIDY = { name: "t", keywords: ["pi-package"], peerDependencies: { typebox: "*" } };

test("整洁的包没有发现", () => {
  assert.deepEqual(inspect(TIDY, ["skills/a/SKILL.md"]), []);
});

test("三个安装钩子都是高", () => {
  const f = inspect({ ...TIDY, scripts: { preinstall: "a", install: "b", postinstall: "c", test: "d" } }, ["skills/a/SKILL.md"]);
  assert.deepEqual(codes(f), ["script:preinstall", "script:install", "script:postinstall"]);
  assert.equal(hasBlocking(f), true);
});

test("本地来源 pi 不跑 npm：安装钩子降为提示", () => {
  const f = inspect({ ...TIDY, scripts: { postinstall: "c" } }, ["skills/a/SKILL.md"], "local");
  assert.equal(f[0]?.severity, "提示");
  assert.equal(hasBlocking(f), false);
});

test("binding.gyp 且没有 install/preinstall：隐式 node-gyp rebuild", () => {
  assert.deepEqual(codes(inspect(TIDY, ["binding.gyp", "skills/a/SKILL.md"])), ["script:implicit-gyp"]);
  assert.deepEqual(codes(inspect({ ...TIDY, scripts: { install: "x" } }, ["binding.gyp", "skills/a/SKILL.md"])), ["script:install"]);
});

test("prepare 只在 git 来源时报", () => {
  const pkg = { ...TIDY, scripts: { prepare: "tsc" } };
  assert.deepEqual(codes(inspect(pkg, ["skills/a/SKILL.md"])), []);
  assert.deepEqual(codes(inspect(pkg, ["skills/a/SKILL.md"], "git")), ["script:prepare"]);
});

test("宿主模块写进 dependencies 或 bundledDependencies", () => {
  const f = inspect({ ...TIDY, dependencies: { "@earendil-works/pi-tui": "^1", lodash: "4" }, bundledDependencies: ["@earendil-works/pi-tui"] }, ["skills/a/SKILL.md"]);
  assert.deepEqual(codes(f), ["dep:host-in-dependencies", "dep:host-bundled"]);
});

test("空清单：什么也不加载，还盖住了约定目录", () => {
  assert.deepEqual(codes(inspect({ ...TIDY, pi: {} }, ["skills/a/SKILL.md"])), ["manifest:empty", "manifest:shadows-convention"]);
});

test("既没清单也没约定目录", () => {
  const f = inspect(TIDY, ["index.ts"]);
  assert.deepEqual(codes(f), ["manifest:empty"]);
  assert.match(f[0]?.message ?? "", /本地来源/);
});

test("缺 pi-package 关键字只是提示", () => {
  const f = inspect({ name: "t" }, ["skills/a/SKILL.md"]);
  assert.deepEqual(f.map((x) => [x.severity, x.code]), [["提示", "gallery:keyword"]]);
});

test("按严重程度排序", () => {
  const f = inspect({ name: "t", scripts: { postinstall: "x" }, pi: {} }, ["a.md"]);
  assert.deepEqual(f.map((x) => x.severity), ["高", "中", "提示"]);
});
