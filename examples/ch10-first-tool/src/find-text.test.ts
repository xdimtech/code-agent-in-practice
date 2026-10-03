import assert from "node:assert/strict";
import { test } from "node:test";
import { createFindTextTool, findText, prepareArguments, resolveInside, TOOL_NAME, type Params } from "./find-text.ts";
import { runBatch } from "./host.ts";
import { memFs } from "./memfs.ts";

const CWD = "/w";
const ctx = { cwd: CWD };
const files = {
  "/w/a.txt": "alpha\nBeta\ngamma beta\n",
  "/w/sub/b.txt": "beta 2\n",
  "/w/.git/HEAD": "beta in git\n",
  "/w/node_modules/m/i.js": "beta in deps\n",
};
const run = (p: Params, fs = memFs(files)) => findText(fs, ctx, p);
const out = (r: { content: readonly { text: string }[] }) => r.content[0].text;

test("按行找，输出 path:line:text；跳过 .git 和 node_modules", async () => {
  const r = await run({ pattern: "beta" });
  assert.equal(out(r), "a.txt:3:gamma beta\nsub/b.txt:1:beta 2");
  assert.deepEqual(r.details, { pattern: "beta", path: ".", matches: 2, filesScanned: 2, skippedLarge: 0 });
});

test("忽略大小写、正则", async () => {
  assert.equal((await run({ pattern: "beta", ignoreCase: true })).details.matches, 3);
  assert.equal(out(await run({ pattern: "^b", regex: true, ignoreCase: true })), "a.txt:2:Beta\nsub/b.txt:1:beta 2");
});

test("模式里的特殊字符按字面找：不经过 shell，也不当正则", async () => {
  const fs = memFs({ "/w/x.sh": "echo $(whoami); rm -rf *\n" });
  assert.equal(out(await run({ pattern: "$(whoami); rm -rf *" }, fs)), "x.sh:1:echo $(whoami); rm -rf *");
});

test("没找到：正常结果，不是错误", async () => {
  assert.equal(out(await run({ pattern: "zzz" })), "No matches found");
});

test("路径：去掉开头的 @；可以指向单个文件", async () => {
  assert.equal(out(await run({ pattern: "beta", path: "@sub" })), "sub/b.txt:1:beta 2");
  assert.equal(out(await run({ pattern: "alpha", path: "a.txt" })), "a.txt:1:alpha");
});

test("路径跑出工作目录、不存在、是符号链接：抛错", async () => {
  assert.throws(() => resolveInside(CWD, "../etc"), /outside the working directory/);
  assert.throws(() => resolveInside(CWD, "/etc/passwd"), /outside/);
  assert.equal(resolveInside(CWD, "..w/x"), "/w/..w/x");
  await assert.rejects(run({ pattern: "x", path: "missing" }), /Path not found: missing/);
  await assert.rejects(run({ pattern: "x", path: "ln" }, memFs(files, ["/w/ln"])), /symlinks are not followed/);
});

test("目录里的符号链接不跟随", async () => {
  const r = await run({ pattern: "beta" }, memFs(files, ["/w/link"]));
  assert.equal(r.details.filesScanned, 2);
});

test("空模式、坏正则：抛错", async () => {
  await assert.rejects(run({ pattern: "" }), /must not be empty/);
  await assert.rejects(run({ pattern: "(", regex: true }), /Invalid regex/);
});

test("太大的文件跳过，并在结果里说出来", async () => {
  const r = await run({ pattern: "beta" }, memFs({ ...files, "/w/big.log": `beta\n${"x".repeat(1024 * 1024)}` }));
  assert.equal(r.details.skippedLarge, 1);
  assert.match(out(r), /1 files larger than 1\.0MB were skipped/);
});

test("长行截到 500 字符", async () => {
  const r = await run({ pattern: "needle" }, memFs({ "/w/l.txt": `needle${"x".repeat(600)}` }));
  assert.ok(out(r).endsWith("... [truncated]"));
});

test("结果超过 2000 行：截断，全文另存，提示里给路径", async () => {
  const fs = memFs({ "/w/many.txt": Array.from({ length: 2500 }, (_, i) => `hit ${i}`).join("\n") });
  const r = await run({ pattern: "hit" }, fs);
  const lines = out(r).split("\n");
  assert.equal(lines[1999], "many.txt:2000:hit 1999");
  assert.match(lines.at(-1) as string, /^\[Output truncated: showing 2000 of 2500 lines .* Full output saved to: \/tmp\/find-text-1\/output\.txt\]$/);
  assert.equal(fs.saved.get("/tmp/find-text-1/output.txt")?.split("\n").length, 2500);
  assert.equal((r.details as { fullOutputPath?: string }).fullOutputPath, "/tmp/find-text-1/output.txt");
});

test("全文存不下来：照样返回截断结果，提示里说明原因", async () => {
  const fs = memFs({ "/w/many.txt": Array.from({ length: 2500 }, () => "hit").join("\n") }, [], true);
  const r = await run({ pattern: "hit" }, fs);
  assert.match(out(r), /Full output could not be saved: ENOSPC/);
  assert.equal((r.details as { fullOutputPath?: string }).fullOutputPath, undefined);
});

test("每扫 200 个文件报一次进度", async () => {
  const many = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`/w/f${i}.txt`, "x"]));
  const updates: unknown[] = [];
  await findText(memFs(many), ctx, { pattern: "y" }, undefined, (u) => void updates.push(u.details));
  assert.deepEqual(updates, [{ progress: 200 }, { progress: 400 }]);
});

test("中止信号：抛错", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(findText(memFs(files), ctx, { pattern: "x" }, ac.signal), /aborted/);
});

test("prepareArguments：旧名 query 改成 pattern，两个都给时不动", () => {
  assert.deepEqual(prepareArguments({ query: "x", path: "." }), { pattern: "x", path: "." });
  assert.deepEqual(prepareArguments({ query: "x", pattern: "y" }), { query: "x", pattern: "y" });
  assert.equal(prepareArguments("raw"), "raw");
});

test("工具定义：名字、promptSnippet、Guidelines 写出工具名、description 写明上限", () => {
  const t = createFindTextTool(memFs(files));
  assert.equal(t.name, TOOL_NAME);
  assert.ok(t.promptSnippet && !t.promptSnippet.includes("\n"));
  assert.ok(t.promptGuidelines?.every((g) => g.includes(TOOL_NAME)));
  assert.match(t.description, /2000 lines or 50\.0KB/);
  assert.equal(t.executionMode, undefined);
});

test("经过宿主：旧参数名 + 字符串布尔也能跑通；多余字段被拒", async () => {
  const tool = createFindTextTool(memFs(files));
  const r = await runBatch({ tools: [tool], calls: [{ id: "1", name: TOOL_NAME, arguments: { query: "BETA", ignoreCase: "true", path: null } }], ctx });
  assert.equal(r.messages[0].isError, false);
  assert.equal((r.messages[0].details as { matches: number }).matches, 3);
  const bad = await runBatch({ tools: [tool], calls: [{ id: "2", name: TOOL_NAME, arguments: { pattern: "x", recursive: true } }], ctx });
  assert.match(bad.messages[0].content[0].text, /recursive: is not allowed/);
});
