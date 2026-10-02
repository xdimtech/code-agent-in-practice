import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

test("演示：退出码 0，六段输出的关键结论都在", () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /\/work\/shop\/services\/pay\/AGENTS\.override\.md/);
  assert.doesNotMatch(stdout, /CLAUDE\.md\n/);
  assert.match(stdout, /未信任项目也照样加载 4 份/);
  assert.match(stdout, /未信任：deploy, review/);
  assert.match(stdout, /已信任：deploy\(project\)/);
  assert.match(stdout, /\[collision\] \/home\/dev\/\.pi\/agent\/skills\/deploy\/SKILL\.md/);
  assert.match(stdout, /去掉 read 工具后技能清单还在吗：false/);
  assert.match(stdout, /\| References are relative to \/work\/shop\/\.agents\/skills\/db-migrate\./);
  assert.match(stdout, /整块只剩 1 个闭合标签/);
  assert.match(stdout, /错误：broken: 读取配置失败/);
  assert.match(stdout, /下一轮没人改：退回基础版本/);
  assert.match(stdout, /变了才注入持久消息 +\d+ +\d+ +\d+\.\d% +0 +3/);
});
