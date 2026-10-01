import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

function start(...args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DEMO_API_KEY: "" },
  });
}

test("不带参数跑演示：退出码 0，五段输出都在", () => {
  const { status, stdout } = start();
  assert.equal(status, 0);
  assert.match(stdout, /✗ demo-extensions\/broken\.ts：工厂函数抛错/);
  assert.match(stdout, /回滚检查：demo:ping 订阅者 1 个；flag：（无）/);
  assert.match(stdout, /! demo-extensions\/noisy\.ts：连不上遥测服务/);
  assert.match(stdout, /bash \{\} → 拦下：扩展出错，按拦截处理/);
  assert.match(stdout, /与保留键 interrupt 冲突，已跳过/);
  assert.match(stdout, /hello\(\{ name: "pi" \}\) → Hello, pi!/);
});

test("给自己的扩展路径：有加载失败时退出码 1", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ext-host-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "ok.js"), "export default function () {}\n");
  assert.equal(start(join(dir, "ok.js")).status, 0);
  const { status, stdout } = start(join(dir, "ok.js"), join(dir, "missing.ts"));
  assert.equal(status, 1);
  assert.match(stdout, /missing\.ts：不存在/);
});
