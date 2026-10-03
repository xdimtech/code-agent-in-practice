import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { jsonCapture, rpcCapture } from "./fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "ch03-main-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const main = join(import.meta.dirname, "main.ts");

function run(args: readonly string[]) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text, { mode: 0o600 });
  return path;
};

test("不带参数跑演示：六段都在", () => {
  const r = run([]);
  assert.equal(r.code, 0);
  for (const h of ["一、", "二、", "三、", "四、", "五、", "六、"]) assert.ok(r.out.includes(h), h);
});

test("check：成功的 json 输出退 0，失败的退 1", () => {
  const ok = run(["check", file("ok.jsonl", jsonCapture())]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /--mode json/);
  const bad = run(["check", file("bad.jsonl", jsonCapture("error"))]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /run-failed/);
});

test("check：rpc 输出只有提醒，退 0", () => {
  const r = run(["check", file("rpc.jsonl", rpcCapture())]);
  assert.equal(r.code, 0);
  assert.match(r.out, /dialog-without-timeout/);
});

test("check：找不到、是目录、是符号链接都退 2", () => {
  assert.equal(run(["check", join(dir, "nope.jsonl")]).code, 2);
  assert.equal(run(["check", dir]).code, 2);
  const link = join(dir, "link.jsonl");
  symlinkSync(file("target.jsonl", jsonCapture()), link);
  const r = run(["check", link]);
  assert.equal(r.code, 2);
  assert.match(r.err, /符号链接不跟随/);
});

test("switch：列出不同的维度", () => {
  const r = run(["switch", "print", "rpc"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /共 7 个维度不同/);
  assert.equal(run(["switch", "print", "web"]).code, 2);
});

test("choose：参数齐全给出形态和代价；缺参数退 2", () => {
  const r = run(["choose", "--viewer", "nobody", "--host", "other", "--turns", "one", "--events"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^json：/);
  assert.match(r.out, /代价：/);
  assert.equal(run(["choose", "--viewer", "nobody"]).code, 2);
});

test("不认识的子命令、check 不给文件：打用法退 2", () => {
  for (const args of [["frobnicate"], ["check"]]) {
    const r = run(args);
    assert.equal(r.code, 2);
    assert.match(r.err, /用法/);
  }
});
