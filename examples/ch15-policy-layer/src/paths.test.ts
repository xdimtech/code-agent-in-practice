import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWrite } from "./paths.ts";
import { DEFAULT_POLICY } from "./types.ts";

const CWD = "/work/repo";
const check = (target: string, policy = DEFAULT_POLICY) => checkWrite(policy, CWD, target);
const rule = (target: string, policy = DEFAULT_POLICY) => {
  const c = check(target, policy);
  return c.ok ? "ok" : c.rule;
};

test("工作区里的普通文件可以写", () => {
  assert.equal(rule("src/a.ts"), "ok");
  assert.equal(rule("/work/repo/README.md"), "ok");
  assert.equal(rule("."), "ok");
});

test("工作区外：绝对路径、.. 逃逸、~", () => {
  assert.equal(rule("/etc/hosts"), "outside-write-roots");
  assert.equal(rule("../other/x"), "outside-write-roots");
  assert.equal(rule("src/../../x"), "outside-write-roots");
  assert.equal(rule("~/.bashrc"), "outside-write-roots");
  assert.equal(rule("/work/repo-evil/x"), "outside-write-roots"); // 前缀相同不等于在里面
});

test("名字以 .. 开头的目录不是逃逸", () => {
  assert.equal(rule("..cache/x"), "ok");
});

test("受保护路径按段匹配：命中文件名和目录名，不误伤相似的名字", () => {
  assert.equal(rule(".env"), "protected-path");
  assert.equal(rule("config/.env.local"), "protected-path");
  assert.equal(rule(".git/config"), "protected-path");
  assert.equal(rule("certs/server.pem"), "protected-path");
  assert.equal(rule("src/.envoy.ts"), "ok");
  assert.equal(rule(".github/workflows/ci.yml"), "ok");
  assert.equal(rule("docs/environment.md"), "ok");
});

test("绕一圈回来的路径也查得到；大小写不同按同一个文件算", () => {
  assert.equal(rule("src/../.env"), "protected-path");
  assert.equal(rule(".ENV"), "protected-path");
});

test("多个可写目录", () => {
  const policy = { ...DEFAULT_POLICY, writeRoots: ["src", "/tmp"] };
  assert.equal(rule("src/a.ts", policy), "ok");
  assert.equal(rule("/tmp/scratch", policy), "ok");
  assert.equal(rule("README.md", policy), "outside-write-roots");
});

test("没有可写目录就什么都不能写", () => {
  assert.equal(rule("src/a.ts", { ...DEFAULT_POLICY, writeRoots: [] }), "outside-write-roots");
});
