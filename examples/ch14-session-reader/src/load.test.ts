import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_CONFIG_BYTES, probe } from "./load.ts";

test("probe：只读配置文件的内容，auth.json 只看权限", () => {
  const home = mkdtempSync(join(tmpdir(), "ch14-probe-"));
  try {
    const dir = join(home, ".pi", "agent");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "auth.json"), '{"p":{"key":"x"}}', { mode: 0o600 });
    writeFileSync(join(dir, "models.json"), "{}");
    writeFileSync(join(dir, "settings.json"), " ".repeat(MAX_CONFIG_BYTES + 1));
    chmodSync(join(dir, "sessions"), 0o700);
    const p = probe({}, home, "v22.19.0", "linux");
    assert.equal(p.agentDir, dir);
    assert.ok(p.agentDirExists);
    assert.deepEqual({ ...p.auth, size: undefined }, { exists: true, mode: 0o600, size: undefined });
    assert.equal(p.auth.text, undefined);
    assert.equal(p.models.text, "{}");
    assert.equal(p.settings.text, undefined, "超过上限不读");
    assert.equal(p.sessionsDir.mode, 0o700);
    assert.deepEqual(p.debugLog, { exists: false });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("probe：PI_CODING_AGENT_DIR 指到不存在的地方", () => {
  const p = probe({ PI_CODING_AGENT_DIR: "/nonexistent/ch14" }, "/h", "v22.19.0", "linux");
  assert.equal(p.agentDir, "/nonexistent/ch14");
  assert.ok(!p.agentDirExists);
  assert.deepEqual(p.models, { exists: false });
});
