import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateLine, truncateTail, truncationNotice } from "./truncate.ts";

const lines = (n: number, width = 9) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(3, "0")}${"x".repeat(width - 3)}`).join("\n");

test("默认上限：2000 行、50KB", () => {
  assert.equal(DEFAULT_MAX_LINES, 2000);
  assert.equal(DEFAULT_MAX_BYTES, 51200);
});

test("两条上限都没碰到：原样返回，结尾换行不算一行", () => {
  const t = truncateHead("a\nb\n");
  assert.equal(t.truncated, false);
  assert.equal(t.content, "a\nb\n");
  assert.equal(t.totalLines, 2);
  assert.equal(truncationNotice(t), "");
  assert.equal(truncateHead("").totalLines, 0);
});

test("head 碰到行数上限", () => {
  const t = truncateHead(lines(10), { maxLines: 3 });
  assert.equal(t.content, lines(3));
  assert.equal(t.truncatedBy, "lines");
  assert.equal(t.outputLines, 3);
  assert.equal(t.totalLines, 10);
});

test("head 碰到字节上限：只交整行，换行算 1 字节", () => {
  // 每行 9 字节：两行是 9+1+9=19，三行是 29
  const t = truncateHead(lines(10), { maxBytes: 28 });
  assert.equal(t.content, lines(2));
  assert.equal(t.truncatedBy, "bytes");
  assert.equal(t.outputBytes, 19);
});

test("head 第一行就超字节：返回空内容，提示里换说法", () => {
  const t = truncateHead(`${"y".repeat(100)}\nok`, { maxBytes: 50 });
  assert.equal(t.content, "");
  assert.equal(t.firstLineExceedsLimit, true);
  assert.match(truncationNotice(t, "/tmp/full.txt"), /First line alone is larger than the 50B limit.*\/tmp\/full\.txt/);
});

test("字节按 UTF-8 算：一个汉字 3 字节", () => {
  const t = truncateHead("你好\n世界\n再见", { maxBytes: 13 });
  assert.equal(t.content, "你好\n世界");
  assert.equal(t.outputBytes, 13);
});

test("tail 留结尾", () => {
  const t = truncateTail(lines(10), { maxLines: 2 });
  assert.equal(t.content, lines(10).split("\n").slice(-2).join("\n"));
  assert.equal(t.truncatedBy, "lines");
});

test("tail 最后一行就超字节：交半行，切在字符边界上", () => {
  const t = truncateTail("head\n一二三四五", { maxBytes: 7 });
  assert.equal(t.content, "四五");
  assert.equal(t.lastLinePartial, true);
  assert.equal(t.truncatedBy, "bytes");
});

test("提示：看到多少、少了多少、全文在哪", () => {
  const t = truncateHead(lines(10), { maxLines: 3 });
  assert.equal(
    truncationNotice(t, "/tmp/o.txt"),
    "[Output truncated: showing 3 of 10 lines (29B of 99B). 7 lines (70B) omitted. Full output saved to: /tmp/o.txt]",
  );
});

test("formatSize 和 truncateLine", () => {
  assert.deepEqual([formatSize(1023), formatSize(1024), formatSize(1536 * 1024)], ["1023B", "1.0KB", "1.5MB"]);
  assert.deepEqual(truncateLine("abcdef", 3), { text: "abc... [truncated]", cut: true });
  assert.deepEqual(truncateLine("abc", 3), { text: "abc", cut: false });
});
