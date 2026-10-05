import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DEMO_PRICES } from "../src/pricing.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncationSaving } from "../src/truncation.ts";

const SONNET = DEMO_PRICES["anthropic/claude-sonnet-4-5"]!;

test("没超两条上限：原样返回", () => {
	const t = truncateHead("a\nb\nc");
	assert.equal(t.truncated, false);
	assert.equal(t.content, "a\nb\nc");
	assert.equal(t.keptLines, 3);
});

test("行数先到：按行截，by = lines", () => {
	const text = Array.from({ length: DEFAULT_MAX_LINES + 5 }, (_, i) => String(i)).join("\n");
	const t = truncateHead(text);
	assert.equal(t.by, "lines");
	assert.equal(t.keptLines, DEFAULT_MAX_LINES);
	assert.equal(t.totalLines, DEFAULT_MAX_LINES + 5);
});

test("字节先到：不留半行，保留的字节不超上限", () => {
	const text = Array.from({ length: 1_000 }, () => "x".repeat(99)).join("\n");
	const t = truncateHead(text);
	assert.equal(t.by, "bytes");
	assert.ok(t.keptBytes <= DEFAULT_MAX_BYTES);
	assert.equal(t.keptLines, Math.floor((DEFAULT_MAX_BYTES + 1) / 100));
	assert.ok(t.content.split("\n").every((l) => l.length === 99));
});

test("多字节字符按 UTF-8 字节计", () => {
	const t = truncateHead("中文\n中文", 10, 7);
	assert.equal(t.totalBytes, 13);
	assert.equal(t.keptLines, 1);
	assert.equal(t.keptBytes, 6);
});

test("上限不是正数就报错", () => {
	assert.throws(() => truncateHead("a", 0), RangeError);
	assert.throws(() => truncateHead("a", 10, -1), RangeError);
});

test("省下的钱：当轮按写入价，之后每轮按读价", () => {
	const t = truncateHead("x".repeat(80_000), 10, 40_000);
	const s = truncationSaving(t, 10, SONNET);
	assert.equal(s.droppedTokens, 20_000);
	assert.ok(Math.abs(s.firstTurn - (20_000 * SONNET.cacheWrite) / 1e6) < 1e-12);
	assert.ok(Math.abs(s.perLaterTurn - (20_000 * SONNET.cacheRead) / 1e6) < 1e-12);
	assert.ok(Math.abs(s.total - (s.firstTurn + 10 * s.perLaterTurn)) < 1e-12);
	assert.throws(() => truncationSaving(t, -1, SONNET), RangeError);
});
