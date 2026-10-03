import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "ch10-main-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const main = join(import.meta.dirname, "main.ts");

function run(args: readonly string[], cwd = dir) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

mkdirSync(join(dir, "src"));
writeFileSync(join(dir, "src", "a.ts"), "// TODO: one\nconst x = 1;\n");
writeFileSync(join(dir, "log.txt"), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n"));
symlinkSync(join(dir, "log.txt"), join(dir, "link.txt"));

test("不带参数跑演示：五段都在", () => {
  const r = run([]);
  assert.equal(r.code, 0);
  for (const h of ["一、", "二、", "三、", "四、", "五、"]) assert.ok(r.out.includes(h), h);
});

test("search：找到退 0，工具出错退 1", () => {
  const hit = run(["search", "todo", "src", "-i"]);
  assert.equal(hit.code, 0);
  assert.equal(hit.out.trim(), "src/a.ts:1:// TODO: one");
  const miss = run(["search", "zzz"]);
  assert.equal(miss.code, 0);
  assert.match(miss.out, /No matches found/);
  const outside = run(["search", "x", "../.."]);
  assert.equal(outside.code, 1);
  assert.match(outside.out, /outside the working directory/);
  assert.equal(run(["search", "(", "--regex"]).code, 1);
});

test("tools：按旗标列出激活的工具", () => {
  const r = run(["tools", "--no-builtin-tools", "--ext", "find_text=Search text", "--ext", "deploy"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /激活：find_text\(extension\) deploy\(extension\)/);
  assert.match(r.out, /没列出（没有 promptSnippet）：deploy/);
});

test("truncate：head / tail 按上限截断", () => {
  const h = run(["truncate", "head", join(dir, "log.txt"), "--lines", "3"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /^line 1\nline 2\nline 3\n\n\[Output truncated: showing 3 of 50 lines/);
  const t = run(["truncate", "tail", join(dir, "log.txt"), "--bytes", "16"]);
  assert.match(t.out, /^line 49\nline 50\n/);
});

test("输入有问题退 2", () => {
  const cases = [
    ["nope"],
    ["search"],
    ["search", "x", "--wat"],
    ["tools", "--tools"],
    ["tools", "--ext", "Bad Name"],
    ["tools", "--bogus"],
    ["truncate", "middle", "x"],
    ["truncate", "head", join(dir, "missing.txt")],
    ["truncate", "head", join(dir, "src")],
    ["truncate", "head", join(dir, "link.txt")],
    ["truncate", "head", join(dir, "log.txt"), "--lines", "0"],
    ["truncate", "head", join(dir, "log.txt"), "--bytes"],
  ];
  for (const args of cases) {
    const r = run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.ok(r.err.length > 0, args.join(" "));
  }
});
