import assert from "node:assert/strict";
import { test } from "node:test";
import { CORPUS } from "./corpus.ts";
import { piGateFlags, piPathProtected } from "./pi-gate.ts";

test("正则认得它的原型", () => {
  for (const c of ["rm -rf build", "rm -r build", "rm --recursive build", "sudo ls", "chmod 777 x", "chmod -R 0777 x"]) assert.equal(piGateFlags(c), true, c);
});

test("正则漏掉的：选项换序、前面多一个选项、不叫 rm 的删除", () => {
  for (const c of ["rm -fr build", "rm -v -rf build", "find . -delete", "git clean -fdx", "chmod -R a+rwx ."]) assert.equal(piGateFlags(c), false, c);
});

test("正则误报的：只是提到了这几个字", () => {
  assert.equal(piGateFlags("grep -rn 'rm -rf' docs/"), true);
  assert.equal(piGateFlags("echo 'do not run sudo here'"), true);
});

test("语料：13 条里正则判对 1 条有破坏的，误报 2 条无害的", () => {
  const caught = CORPUS.filter((s) => s.destructive && piGateFlags(s.command)).map((s) => s.command);
  assert.deepEqual(caught, ["rm -rf build"]);
  assert.equal(CORPUS.filter((s) => !s.destructive && piGateFlags(s.command)).length, 2);
  assert.equal(CORPUS.length, 13);
});

test("路径保护是子串匹配：会误伤，也分大小写", () => {
  assert.equal(piPathProtected(".env"), true);
  assert.equal(piPathProtected("config/.env.local"), true);
  assert.equal(piPathProtected("src/.envoy.ts"), true); // 误伤：只是文件名以 .env 开头
  assert.equal(piPathProtected(".ENV"), false); // 大小写不敏感的文件系统上这就是 .env
  assert.equal(piPathProtected(".git"), false); // 名单里是 ".git/"，不带斜杠的目录名本身不算
});
