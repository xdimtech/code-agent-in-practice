import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HEADER, jsonl, user } from "./fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = join(here, "..", "demo", "session.jsonl");
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "main.ts"), ...args], { encoding: "utf8", env });
const withTmp = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "ch14-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("演示跑完十一段", () => {
  const out = run([]);
  assert.equal(out.status, 0, out.stderr);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.match(out.stdout, new RegExp(`== ${n}\\. `));
  assert.match(out.stdout, /第 18 行：半截或损坏的 JSON/);
  assert.match(out.stdout, /叶子 = 文件最后一条 = d4a05e62/);
  assert.match(out.stdout, /文件里全部条目：\$0\.1237/);
  assert.match(out.stdout, /［已放弃的分支］.*429/);
  assert.match(out.stdout, /第 3 次调用（第一次在 b27e9a41）/);
  assert.match(out.stdout, /PI_TIMING=true → 不生效/);
  assert.match(out.stdout, /OPENAI_API_KEY=\[已脱敏\]/);
  assert.match(out.stdout, /toolResult ← （凭空）/);
  assert.match(out.stdout, /#6 .*（无响应头）/);
  assert.match(out.stdout, /原样重跑：8\/8 命中/);
  assert.match(out.stdout, /命中 6 个，#7 分岔于 \$\.messages\[7\]\.content/);
  assert.match(out.stdout, /\[失败\] settings\.json/);
  assert.doesNotMatch(out.stdout, /sk-demo-not-a-real-key-000000[^"]*"\}\}\n  遮掉/); // 第 7 段「之后」那一行不带密钥
});

test("--tape：磁带和会话一起检查；磁带坏了退出码 2", () => {
  withTmp((dir) => {
    const good = join(dir, "tape.jsonl");
    const req = { kind: "request", seq: 1, at: "t", sessionId: "other", leafId: null, fingerprint: "f", redactedSecrets: 0, payload: { model: "m", messages: [] } };
    writeFileSync(good, `${JSON.stringify(req)}\n`);
    const out = run([DEMO, "--tape", good]);
    assert.equal(out.status, 1);
    assert.match(out.stdout, /== 磁带 ==/);
    assert.match(out.stdout, /来自别的会话（other）/);
    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, "{not json\n");
    const failed = run([DEMO, "--tape", bad]);
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /第 1 行不是合法 JSON/);
    assert.equal(run([DEMO, "--tape"]).status, 2);
  });
});

test("--doctor：读真实目录，不回显配置内容", () => {
  withTmp((dir) => {
    const secret = ["sk", "abcdefghijklmnopqrstuv"].join("-");
    writeFileSync(join(dir, "auth.json"), "{}", { mode: 0o600 });
    writeFileSync(join(dir, "models.json"), `{ "apiKey": ${secret} }`);
    writeFileSync(join(dir, "settings.json"), '{ "a": 1 }');
    const out = run(["--doctor"], { ...process.env, PI_CODING_AGENT_DIR: dir, PI_TIMING: "1" });
    assert.equal(out.status, 1);
    assert.match(out.stdout, /\[通过\] auth\.json：权限 0600/);
    assert.match(out.stdout, /\[失败\] models\.json：解析失败（第 1 行第 \d+ 列）/);
    assert.match(out.stdout, /\[通过\] settings\.json/);
    assert.match(out.stdout, /\[注意\] PI_TIMING：开着/);
    assert.ok(!out.stdout.includes(secret) && !out.stderr.includes("abcdefghij"));
  });
});

test("检查演示文件：有高级别问题，退出码 1", () => {
  const out = run([DEMO]);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /== 诊断 ==/);
  assert.match(out.stdout, /\[高\]/);
});

test("检查干净的文件：退出码 0", () =>
  withTmp((dir) => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, jsonl(HEADER, user("a", null)));
    const out = run([f]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /没有发现问题/);
  }));

test("文件不存在、不是会话、是符号链接：退出码 2", () =>
  withTmp((dir) => {
    assert.equal(run([join(dir, "nope.jsonl")]).status, 2);
    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, jsonl(user("a", null)));
    const out = run([bad]);
    assert.equal(out.status, 2);
    assert.match(out.stderr, /不是会话头/);
    const link = join(dir, "link.jsonl");
    symlinkSync(DEMO, link);
    assert.match(run([link]).stderr, /符号链接/);
  }));

test("--redact 写脱敏副本，权限 600，不覆盖已有文件", () =>
  withTmp((dir) => {
    const copy = join(dir, "shared.jsonl");
    const first = run([DEMO, "--redact", copy]);
    assert.equal(first.status, 1);
    assert.match(first.stdout, /已写脱敏副本.*密钥 1 处，图片 1 张/);
    const text = readFileSync(copy, "utf8");
    assert.ok(!text.includes("sk-demo"));
    assert.equal(text.split("\n")[0], readFileSync(DEMO, "utf8").split("\n")[0]);
    assert.equal(statSync(copy).mode & 0o777, 0o600);
    const again = run([DEMO, "--redact", copy]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /不覆盖/);
    assert.equal(run([DEMO, "--redact"]).status, 2);
  }));

test("--env：列出七个变量，只回显设了的那几个", () => {
  const secret = "s" + "k-" + "q".repeat(20);
  const out = run(["--env"], { PATH: process.env.PATH, PI_TIMING: "yes", PI_CODING_AGENT_DIR: "/d", SOME_TOKEN: secret });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /日志目录：\/d/);
  assert.match(out.stdout, /PI_EVAL_ARTIFACT_DIR/);
  assert.match(out.stdout, /PI_TIMING=yes → 不生效/);
  assert.ok(!out.stdout.includes(secret));
});
