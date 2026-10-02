import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { signerFor } from "./chain.ts";
import { at, DEMO_KEY, ENTRIES, PI_SESSION } from "./fixtures.ts";
import { buildLog, dropTail, editLine } from "./forge.ts";

const dir = mkdtempSync(join(tmpdir(), "ch25-main-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const main = join(import.meta.dirname, "main.ts");

function run(args: readonly string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text, { mode: 0o600 });
  return path;
};

const plain = buildLog(ENTRIES, signerFor(undefined), at).text;
const keyed = buildLog(ENTRIES, signerFor(DEMO_KEY), at).text;
const KEY_ENV = { AUDIT_LOG_HMAC_KEY: DEMO_KEY.toString("utf8") };

test("不带参数跑演示：六段都在", () => {
  const r = run([]);
  assert.equal(r.code, 0);
  for (const h of ["一、", "二、", "三、", "四、", "五、", "六、"]) assert.ok(r.out.includes(h), h);
});

test("verify：完好退 0，改过退 1", () => {
  assert.equal(run(["verify", file("ok.jsonl", plain)]).code, 0);
  const bad = run(["verify", file("bad.jsonl", editLine(plain, 5, (l) => l.replace("rm -rf build", "ls")))]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /第 5 行断开/);
});

test("verify：密钥从环境变量读；密钥太短退 2", () => {
  const path = file("keyed.jsonl", keyed);
  assert.equal(run(["verify", path], KEY_ENV).code, 0);
  const short = run(["verify", path], { AUDIT_LOG_HMAC_KEY: "short" + "-key" });
  assert.equal(short.code, 2);
  assert.match(short.err, /至少要 32/);
});

test("anchor 出锚点；删掉末尾之后 verify --anchor 退 1", () => {
  const path = file("anchored.jsonl", plain);
  const a = run(["anchor", path]);
  assert.equal(a.code, 0);
  const anchorPath = file("anchor.json", a.out);
  assert.equal(run(["verify", path, "--anchor", anchorPath]).code, 0);
  const cut = run(["verify", file("cut.jsonl", dropTail(plain, 2)), "--anchor", anchorPath]);
  assert.equal(cut.code, 1);
  assert.match(cut.out, /anchor-beyond-tail/);
});

test("anchor：校验不过就不出锚点", () => {
  const r = run(["anchor", file("bad2.jsonl", editLine(plain, 2, (l) => l.replace("c1", "c9")))]);
  assert.equal(r.code, 1);
  assert.equal(r.out.includes('"seq"'), false);
});

test("session：列出事实和问题；没有会话头退 1", () => {
  const r = run(["session", file("s.jsonl", PI_SESSION)]);
  assert.equal(r.code, 0);
  assert.match(r.out, /external-output/);
  assert.equal(run(["session", file("nohead.jsonl", `${JSON.stringify({ type: "message", id: "a" })}\n`)]).code, 1);
});

test("输入错误退 2：未知命令、文件不存在、--anchor 缺值、锚点坏了", () => {
  assert.equal(run(["nope"]).code, 2);
  assert.equal(run(["verify", join(dir, "missing.jsonl")]).code, 2);
  assert.equal(run(["verify", file("x.jsonl", plain), "--anchor"]).code, 2);
  assert.equal(run(["verify", file("y.jsonl", plain), "--anchor", file("bad-anchor.json", "{}")]).code, 2);
});
