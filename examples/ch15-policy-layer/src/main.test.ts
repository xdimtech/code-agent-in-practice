import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ch15-main-"));
const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "main.ts"), ...args], { cwd: dir, encoding: "utf8" });
const file = (name: string, content: string): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

test("不带参数跑演示，六段都在", () => {
  const r = run();
  assert.equal(r.status, 0);
  for (const head of ["一、", "二、", "三、", "四、", "五、", "六、"]) assert.ok(r.stdout.includes(`\n${head}`), head);
  assert.match(r.stdout, /user_bash ：执行了（宿主吞掉了错误：规则文件读不出来）/);
});

test("退出码：放行 0、要问 1、拒绝 2", () => {
  const user = file("auto.json", '{"mode":"auto"}');
  assert.equal(run("npm test", "--user-policy", user).status, 0);
  assert.equal(run("rm -fr build", "--user-policy", user).status, 1);
  assert.equal(run("echo x > .env", "--user-policy", user).status, 2);
  assert.equal(run("npm test").status, 1);
});

test("输出里有分析结果和命中的规则", () => {
  const r = run("python3 -c 'print(1)'");
  assert.match(r.stdout, /分析：看不全/);
  assert.match(r.stdout, /决定：要问 {2}\[unresolved\]/);
});

test("项目策略想放松：照常判断，放松请求打到 stderr", () => {
  const user = file("auto2.json", '{"mode":"auto"}');
  const project = file("loose.json", '{"mode":"auto","gateUserCommands":false}');
  const r = run("rm -rf x", "--user", "--user-policy", user, "--project-policy", project);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /忽略项目策略里的放松请求：gateUserCommands 想关掉/);
});

test("项目策略可以收紧", () => {
  const project = file("strict.json", '{"mode":"read-only"}');
  assert.equal(run("npm test", "--project-policy", project).status, 2);
});

test("用户策略可以豁免自己敲的命令", () => {
  const user = file("exempt.json", '{"gateUserCommands":false}');
  assert.equal(run("rm -rf x", "--user", "--user-policy", user).status, 0);
  assert.equal(run("rm -rf x", "--user-policy", user).status, 1);
});

test("用法错误和坏策略文件：退出码 64，不往下判断", () => {
  assert.equal(run("--user").status, 64);
  assert.equal(run("ls", "--user-policy").status, 64);
  const bad = run("ls", "--project-policy", file("typo.json", '{"protectedPath":[".env"]}'));
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /不认识的键：protectedPath/);
  assert.equal(run("ls", "--user-policy", join(dir, "missing.json")).status, 64);
});
