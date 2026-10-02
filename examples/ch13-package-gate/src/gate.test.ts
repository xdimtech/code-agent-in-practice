import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gatedInstallArgs, gitInstallArgs, LockfileError, nameFromLockPath, packageManagerName,
  parseLockfile, piInstallArgs, rebuildArgs, reviewInstallScripts,
} from "./gate.ts";

test("包管理器名：取最后一个 -- 之后的命令，去掉 .cmd/.exe", () => {
  assert.equal(packageManagerName(undefined), "npm");
  assert.equal(packageManagerName(["mise", "exec", "node@20", "--", "pnpm"]), "pnpm");
  assert.equal(packageManagerName(["C:/tools/bun.exe"]), "bun");
});

test("pi 的三个分支都没有 --ignore-scripts", () => {
  for (const pm of ["npm", "pnpm", "bun"]) assert.equal(piInstallArgs(pm, ["x"], "/r").includes("--ignore-scripts"), false);
  assert.deepEqual(piInstallArgs("npm", ["x"], "/r"), ["install", "x", "--prefix", "/r", "--legacy-peer-deps"]);
  assert.deepEqual(piInstallArgs("bun", ["x"], "/r"), ["install", "x", "--cwd", "/r", "--omit=peer"]);
});

test("闸门版只在末尾多一个 --ignore-scripts", () => {
  for (const pm of ["npm", "pnpm", "bun"]) {
    assert.deepEqual(gatedInstallArgs(pm, ["x"], "/r"), [...piInstallArgs(pm, ["x"], "/r"), "--ignore-scripts"]);
  }
});

test("git 来源：自定义 npmCommand 时不带 --omit=dev", () => {
  assert.deepEqual(gitInstallArgs(false, false), ["install", "--omit=dev"]);
  assert.deepEqual(gitInstallArgs(true, true), ["install", "--ignore-scripts"]);
});

test("lockfile 路径取最后一段 node_modules 之后的包名", () => {
  assert.equal(nameFromLockPath("node_modules/@s/a/node_modules/b"), "b");
  assert.equal(nameFromLockPath("node_modules/@s/a"), "@s/a");
  assert.equal(nameFromLockPath(""), undefined);
});

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { name: "root" },
    "node_modules/a": { version: "1.0.0", hasInstallScript: true },
    "node_modules/b": { version: "2.0.0" },
    "node_modules/x/node_modules/a": { version: "1.0.0", hasInstallScript: true },
    "node_modules/c": { version: "3.0.0", hasInstallScript: true },
  },
});

test("parseLockfile 跳过根条目，读出 hasInstallScript", () => {
  const entries = parseLockfile(LOCK);
  assert.equal(entries.length, 4);
  assert.equal(entries.filter((e) => e.hasInstallScript).length, 3);
});

test("lockfile 结构不对就拒绝", () => {
  assert.throws(() => parseLockfile("nope"), LockfileError);
  assert.throws(() => parseLockfile('{"lockfileVersion":1,"dependencies":{}}'), LockfileError);
  assert.throws(() => parseLockfile('{"lockfileVersion":3}'), LockfileError);
});

test("审查：放行、拦下、过期三类，同一个 name@version 只算一次", () => {
  const review = reviewInstallScripts(parseLockfile(LOCK), new Map([["a@1.0.0", "已审"], ["gone@1.0.0", "旧"]]));
  assert.deepEqual(review, { allowed: ["a@1.0.0"], blocked: ["c@3.0.0"], stale: ["gone@1.0.0"] });
});

test("白名单按版本：升级之后要重新审", () => {
  const review = reviewInstallScripts(parseLockfile(LOCK), new Map([["a@0.9.0", "旧版本审过"], ["c@3.0.0", "已审"]]));
  assert.deepEqual(review.blocked, ["a@1.0.0"]);
});

test("补跑只针对放行的包；带 scope 的包名保留", () => {
  assert.deepEqual(rebuildArgs(["@s/a@1.0.0", "b@2.0.0"], "/r"), ["rebuild", "@s/a", "b", "--prefix", "/r"]);
  assert.deepEqual(rebuildArgs([], "/r"), []);
});
