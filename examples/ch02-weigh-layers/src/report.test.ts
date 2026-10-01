import { test } from "node:test";
import assert from "node:assert/strict";
import { displayWidth, renderCompare, renderSingle } from "./report.ts";

test("全角字符占两格", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("内核"), 4);
  assert.equal(displayWidth("Provider 适配（ai）"), 19);
});

test("单仓库：标题带合计，每行带占比", () => {
  const out = renderSingle("pi", [
    { name: "内核", lines: 25, files: 1 },
    { name: "产品", lines: 75, files: 3 },
  ]);
  const [title, kernel, product] = out.split("\n");
  assert.equal(title, "pi（100 行 / 4 个文件）");
  assert.match(kernel, /25\s+25\.0%\s+█{6}$/);
  assert.match(product, /75\s+75\.0%\s+█{18}$/);
});

test("对照：按层名对齐，只在一边出现的层另一边记 0，Δ 带符号", () => {
  const out = renderCompare(
    { title: "pi", rows: [{ name: "内核", lines: 794, files: 1 }, { name: "产品", lines: 1000, files: 2 }] },
    { title: "fork", rows: [{ name: "内核", lines: 794, files: 1 }, { name: "新增", lines: 300, files: 1 }] },
  ).split("\n");
  assert.match(out[1], /内核\s+794\s+794\s+0$/);
  assert.match(out[2], /产品\s+1,000\s+0\s+−1,000$/);
  assert.match(out[3], /新增\s+0\s+300\s+\+300$/);
  assert.match(out[4], /合计\s+1,794\s+1,094\s+−700$/);
});
