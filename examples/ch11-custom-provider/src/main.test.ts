import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

test("演示：退出码 0，六段输出的关键结论都在", () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /不缓存跑了 3 次，缓存后跑了 1 次/);
  assert.match(stdout, /unregister 之后回到起点：deepseek-chat, deepseek-reasoner, deepseek-distill-local/);
  assert.match(stdout, /corp 的登录方式：oauth；deepseek：apiKey \+ oauth/);
  assert.match(stdout, /派发 acme-1 +→ 扩展的 streamSimple/);
  assert.match(stdout, /✗ half-done：.*必须给 "api"/);
  assert.match(stdout, /! Provider "lab": /);
  assert.match(stdout, /toolcall {2}call_1 read \{"path":"src\/db.ts","limit":40\}/);
  assert.match(stdout, /自己发请求的 streamSimple 服务端收到：✗ 明文/);
  assert.match(stdout, /委托内置适配器的 streamSimple 服务端收到：✓/);
  assert.doesNotMatch(stdout, /env-key-0001|cmd-key-0001/, "演示密钥只打印掩码");
});
