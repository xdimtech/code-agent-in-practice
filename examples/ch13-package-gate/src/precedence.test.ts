import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupePackages, packageIdentity, precedenceRank, resolveNames, type NamedResource } from "./precedence.ts";

const DIRS = { user: "/home/me/.pi/agent", project: "/work/shop/.pi", temporary: "/tmp" } as const;

test("五级优先级：项目显式 < 项目自动 < 用户显式 < 用户自动 < 包", () => {
  assert.equal(precedenceRank({ origin: "top-level", scope: "project", source: "local" }), 0);
  assert.equal(precedenceRank({ origin: "top-level", scope: "project", source: "auto" }), 1);
  assert.equal(precedenceRank({ origin: "top-level", scope: "user", source: "local" }), 2);
  assert.equal(precedenceRank({ origin: "top-level", scope: "user", source: "auto" }), 3);
  assert.equal(precedenceRank({ origin: "package", scope: "project", source: "local" }), 4);
});

test("包里的同名技能盖不住你自己的，哪怕包装在项目作用域", () => {
  const skills: NamedResource[] = [
    { name: "x", path: "pkg/x", origin: "package", scope: "project", source: "local" },
    { name: "x", path: "user/x", origin: "top-level", scope: "user", source: "auto" },
  ];
  const r = resolveNames(skills);
  assert.deepEqual(r.winners.map((w) => w.path), ["user/x"]);
  assert.deepEqual(r.collisions, [{ name: "x", winner: "user/x", loser: "pkg/x" }]);
});

test("同一级里按出现顺序先到先得", () => {
  const skills: NamedResource[] = [
    { name: "x", path: "a", origin: "package", scope: "project", source: "local" },
    { name: "x", path: "b", origin: "package", scope: "user", source: "local" },
  ];
  assert.equal(resolveNames(skills).winners[0]?.path, "a");
});

test("包身份不含版本，git 的 SSH 与 HTTPS 是同一个", () => {
  assert.equal(packageIdentity("npm:@scope/pkg@1.2.3", "/"), "npm:@scope/pkg");
  assert.equal(packageIdentity("npm:pkg", "/"), "npm:pkg");
  assert.equal(packageIdentity("https://github.com/u/r@v1", "/"), "git:github.com/u/r");
  assert.equal(packageIdentity("git:git@github.com:u/r.git@v2", "/"), "git:github.com/u/r");
  assert.equal(packageIdentity("ssh://git@github.com/u/r", "/"), "git:github.com/u/r");
  assert.equal(packageIdentity("./pkgs/a", "/work"), "local:/work/pkgs/a");
});

test("同一个包：项目赢", () => {
  const out = dedupePackages([{ source: "npm:a@1", scope: "user" }, { source: "npm:a@2", scope: "project" }], DIRS);
  assert.deepEqual(out, [{ source: "npm:a@2", scope: "project" }]);
});

test("项目那份 autoload: false：作为差量，两份都留，差量在前", () => {
  const out = dedupePackages([{ source: "npm:a", scope: "project", autoload: false }, { source: "npm:a", scope: "user" }], DIRS);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.scope, "project");
});

test("本地路径按各自 settings 所在目录解析，所以同名相对路径不是同一个包", () => {
  const out = dedupePackages([{ source: "./a", scope: "user" }, { source: "./a", scope: "project" }], DIRS);
  assert.equal(out.length, 2);
});
