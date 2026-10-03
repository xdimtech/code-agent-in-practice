import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { code, doc } from "../src/evidence.ts";
import {
	checkCode,
	checkDocs,
	collectEvidence,
	countByStatus,
	findBookRoot,
	markdownUrlOf,
	normalizeMarkdown,
	renderResults,
	rootsFrom,
	verifyAll,
} from "../src/verify.ts";
import type { Roots } from "../src/verify.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BOOK_ROOT = findBookRoot(HERE);
/** 本书仓库旁边若放着 code-agents/（作者的机器上是这样），就顺便核对 pi 和 codex */
const SOURCES = process.env.CODE_AGENTS_DIR ?? (BOOK_ROOT === undefined ? undefined : resolve(BOOK_ROOT, "../code-agents"));
const HAVE_SOURCES = SOURCES !== undefined && existsSync(join(SOURCES, "pi")) && existsSync(join(SOURCES, "codex"));

function withRepo(run: (roots: Roots) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "ch05-verify-"));
	try {
		mkdirSync(join(directory, "pi", "src"), { recursive: true });
		writeFileSync(join(directory, "pi", "src", "a.ts"), "line one\nline two\nline three\n");
		run(rootsFrom(undefined, directory));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("findBookRoot 从例子目录往上找到本书仓库", () => {
	assert.ok(BOOK_ROOT);
	assert.ok(existsSync(join(BOOK_ROOT, "SUMMARY.md")));
	assert.equal(findBookRoot(tmpdir()), undefined);
});

test("rootsFrom：没给 sources 时 pi / codex 为空", () => {
	assert.deepEqual(rootsFrom("/book", undefined), { book: "/book", pi: undefined, codex: undefined });
	assert.deepEqual(rootsFrom("/book", ""), { book: "/book", pi: undefined, codex: undefined });
	assert.deepEqual(rootsFrom(undefined, "/src"), { book: undefined, pi: "/src/pi", codex: "/src/codex" });
});

test("checkCode：命中、文件不存在、越界、找不到原文、跑出仓库根", () => {
	withRepo((roots) => {
		assert.equal(checkCode(code("pi", "src/a.ts", 2, 3, "two"), roots).status, "ok");
		assert.match(checkCode(code("pi", "src/b.ts", 1, 1, "x"), roots).detail, /文件不存在/);
		assert.match(checkCode(code("pi", "src/a.ts", 3, 9, "x"), roots).detail, /行号越界/);
		assert.match(checkCode(code("pi", "src/a.ts", 1, 1, "two"), roots).detail, /找不到「two」/);
		assert.match(checkCode(code("pi", "../escape.ts", 1, 1, "x"), roots).detail, /跑出了仓库根/);
		assert.match(checkCode(code("pi", "/etc/hosts", 1, 1, "x"), roots).detail, /跑出了仓库根/);
	});
});

test("checkCode：没有源码目录时记为跳过，不记为通过", () => {
	const result = checkCode(code("codex", "LICENSE", 1, 1, "Apache"), rootsFrom(undefined, undefined));
	assert.equal(result.status, "skipped");
});

test("normalizeMarkdown：链接只留文字、去转义、折叠空白，反引号保留", () => {
	assert.equal(normalizeMarkdown("see [the docs](https://x.y/z)  now"), "see the docs now");
	assert.equal(normalizeMarkdown("\"\\{Name} Powered\""), "\"{Name} Powered\"");
	assert.equal(normalizeMarkdown("a `claude`\n  CLI"), "a `claude` CLI");
});

test("markdownUrlOf：加 .md，不重复加", () => {
	assert.equal(markdownUrlOf("https://e.com/a"), "https://e.com/a.md");
	assert.equal(markdownUrlOf("https://e.com/a.md"), "https://e.com/a.md");
});

test("checkDocs：不联网时全部跳过；联网时逐字比对，抓不到算失败", async () => {
	const located = [
		{ where: "a", evidence: doc("https://e.com/a", "Hello world.") },
		{ where: "b", evidence: doc("https://e.com/a", "Not there.") },
		{ where: "c", evidence: doc("https://e.com/down", "Anything.") },
	];
	const offline = await checkDocs(located, undefined);
	assert.deepEqual(
		offline.map((result) => result.status),
		["skipped", "skipped", "skipped"],
	);
	const fetched: string[] = [];
	const online = await checkDocs(located, async (url) => {
		fetched.push(url);
		if (url.includes("down")) throw new Error("HTTP 503");
		return "Intro. [Hello](https://e.com)\n world. Bye.";
	});
	assert.deepEqual(
		online.map((result) => result.status),
		["ok", "fail", "fail"],
	);
	assert.match(online[2]?.detail ?? "", /HTTP 503/);
	assert.deepEqual(fetched, ["https://e.com/a.md", "https://e.com/down.md"], "同一个页面只抓一次");
});

test("collectEvidence：事实、义务、规则的出处一条不漏，都标了位置", () => {
	const located = collectEvidence();
	assert.ok(located.length > 50);
	assert.ok(located.some((item) => item.where.startsWith("规则 ")));
	assert.ok(located.some((item) => item.where.endsWith("/ 自己扛")));
});

test("本书仓库自己的出处（book:）全部核对通过", async () => {
	const results = await verifyAll(rootsFrom(BOOK_ROOT, undefined), undefined);
	const book = results.filter((result) => result.evidence.kind === "code" && result.evidence.repo === "book");
	assert.ok(book.length > 0);
	for (const result of book) assert.equal(result.status, "ok", `${result.where}：${result.detail}`);
});

test("pi 和 codex 的出处在基准 commit 上全部核对通过", { skip: HAVE_SOURCES ? false : "没有 code-agents 源码目录" }, async () => {
	const results = await verifyAll(rootsFrom(BOOK_ROOT, SOURCES), undefined);
	const counts = countByStatus(results);
	assert.equal(counts.fail, 0, renderResults(results));
	assert.equal(results.filter((result) => result.evidence.kind === "code" && result.status !== "ok").length, 0);
});

test("renderResults：失败逐条列出，跳过的原因去重", () => {
	withRepo((roots) => {
		const evidence = code("pi", "src/a.ts", 1, 1, "nope");
		const text = renderResults([
			{ where: "x", ...checkCode(evidence, roots) },
			{ where: "y", ...checkCode(code("codex", "a", 1, 1, "a"), roots) },
			{ where: "z", ...checkCode(code("codex", "b", 1, 1, "b"), rootsFrom(undefined, undefined)) },
			{ where: "w", ...checkCode(code("codex", "c", 1, 1, "c"), rootsFrom(undefined, undefined)) },
		]);
		assert.match(text, /失败 2/);
		assert.match(text, /✗ x：【代码事实】pi:src\/a\.ts:1/);
		assert.equal(text.split("跳过：").length - 1, 1);
	});
});
