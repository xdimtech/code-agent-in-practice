import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { badTrace, goodTrace } from "./fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "ch09-main-"));
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

test("不带参数跑演示：五段都在", () => {
  const r = run([]);
  assert.equal(r.code, 0);
  for (const h of ["一、", "二、", "三、", "四、", "五、"]) assert.ok(r.out.includes(h), h);
});

test("find：命中和没命中都退 0", () => {
  const hit = run(["find", "脱敏"]);
  assert.equal(hit.code, 0);
  assert.match(hit.out, /before_provider_request/);
  const miss = run(["find", "完全不相关"]);
  assert.equal(miss.code, 0);
  assert.match(miss.out, /没有/);
});

test("event：认识的给卡片，不认识的退 2", () => {
  const ok = run(["event", "tool_call"]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /block/);
  assert.equal(run(["event", "auto_retry_start"]).code, 2);
});

test("events / apis：全表", () => {
  assert.equal(run(["events"]).out.trim().split("\n").length, 36);
  assert.match(run(["apis"]).out, /registerTool/);
});

test("order：顺序对退 0，有错退 1", () => {
  assert.equal(run(["order", file("good.jsonl", goodTrace())]).code, 0);
  const bad = run(["order", file("bad.jsonl", badTrace())]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /call-before-start/);
});

test("输入有问题退 2：没参数、找不到文件、目录、符号链接、未知命令", () => {
  const link = join(dir, "link.jsonl");
  symlinkSync(file("target.jsonl", goodTrace()), link);
  for (const args of [["order"], ["order", join(dir, "missing.jsonl")], ["order", dir], ["order", link], ["find"], ["nope"]]) {
    const r = run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.ok(r.err.length > 0);
  }
});
