/**
 * 核对出处。
 *
 * 表里的每一条事实都说「见某文件某行」，这里就真的去那几行找 needle：
 *
 *   code     文件在不在、行号越没越界、那几行里有没有 needle 原文
 *   doc      默认只查形式（https、引文非空）；--online 时把页面的 Markdown 拉下来，逐字找引文
 *   measured / inference  没法机器核对，只列出来，交给读者
 *
 * pi 和 codex 的源码不随本书分发，要用 --sources 指到放着两个仓库的目录（或设 CODE_AGENTS_DIR）。
 * 没给的时候 code 出处记为「跳过」而不是「通过」——没核对过的东西不能算核对过。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { formatEvidence } from "./evidence.ts";
import { RULES } from "./questions.ts";
import { ROUTES } from "./routes.ts";
import type { CodeEvidence, Evidence, Repo } from "./types.ts";
import { DIMENSIONS } from "./types.ts";

export interface Located {
	/** 这条出处挂在哪：`pi / 内置策略`、`规则 pi ← approval` */
	readonly where: string;
	readonly evidence: Evidence;
}

export type CheckStatus = "ok" | "fail" | "skipped" | "manual";

export interface CheckResult {
	readonly where: string;
	readonly evidence: Evidence;
	readonly status: CheckStatus;
	readonly detail: string;
}

export type Roots = Readonly<Record<Repo, string | undefined>>;

/** 抓文档的函数。注入进来，测试里不联网 */
export type FetchText = (url: string) => Promise<string>;

/** 表里所有的出处，事实、义务、规则一个不漏 */
export function collectEvidence(): readonly Located[] {
	const fromRoutes = ROUTES.flatMap((route) => [
		...DIMENSIONS.flatMap((dimension) =>
			route.facts[dimension.id].evidence.map((evidence) => ({ where: `${route.id} / ${dimension.label}`, evidence })),
		),
		...route.ownership.flatMap((fact) => fact.evidence.map((evidence) => ({ where: `${route.id} / 自己扛`, evidence }))),
	]);
	const fromRules = RULES.flatMap((rule) =>
		rule.evidence.map((evidence) => ({ where: `规则 ${rule.route} ← ${Object.keys(rule.when).join("+")}`, evidence })),
	);
	return [...fromRoutes, ...fromRules];
}

/** 从 start 往上找本书仓库的根：同时有 SUMMARY.md 和 book/ 的那一层 */
export function findBookRoot(start: string): string | undefined {
	let current = resolve(start);
	for (;;) {
		if (existsSync(join(current, "SUMMARY.md")) && existsSync(join(current, "book"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** --sources 指的目录下应该有 pi/ 和 codex/ 两个仓库 */
export function rootsFrom(bookRoot: string | undefined, sources: string | undefined): Roots {
	const base = sources === undefined || sources === "" ? undefined : resolve(sources);
	return {
		book: bookRoot,
		pi: base === undefined ? undefined : join(base, "pi"),
		codex: base === undefined ? undefined : join(base, "codex"),
	};
}

/** 出处里的路径必须留在仓库根下面：`../` 或绝对路径一律拒绝 */
function insideRoot(root: string, path: string): string | undefined {
	if (isAbsolute(path)) return undefined;
	const full = resolve(root, path);
	const rel = relative(root, full);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return full;
}

export function checkCode(evidence: CodeEvidence, roots: Roots): Omit<CheckResult, "where"> {
	const root = roots[evidence.repo];
	if (root === undefined) {
		return { evidence, status: "skipped", detail: `没有 ${evidence.repo} 的源码目录（--sources 或 CODE_AGENTS_DIR）` };
	}
	const file = insideRoot(root, evidence.path);
	if (file === undefined) return { evidence, status: "fail", detail: `路径跑出了仓库根：${evidence.path}` };
	if (!existsSync(file)) return { evidence, status: "fail", detail: `文件不存在：${evidence.repo}:${evidence.path}` };
	const lines = readFileSync(file, "utf8").split("\n");
	const [from, to] = evidence.lines;
	if (to > lines.length) {
		return { evidence, status: "fail", detail: `行号越界：文件只有 ${lines.length} 行，要的是 ${from}-${to}` };
	}
	const slice = lines.slice(from - 1, to).join("\n");
	if (!slice.includes(evidence.needle)) {
		return { evidence, status: "fail", detail: `第 ${from}-${to} 行里找不到「${evidence.needle}」` };
	}
	return { evidence, status: "ok", detail: "" };
}

/**
 * 把文档的 Markdown 抹成可以逐字比对的纯文本：链接只留文字、去掉转义反斜杠、空白折叠。
 * 引文里的反引号保留——页面里也有，抹掉反而对不上。
 */
export function normalizeMarkdown(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\\([{}[\]()*_#\\])/g, "$1")
		.replace(/\s+/g, " ");
}

/** 公开文档在原地址后面加 .md 就是 Markdown 源 */
export function markdownUrlOf(url: string): string {
	return url.endsWith(".md") ? url : `${url}.md`;
}

export async function checkDocs(
	located: readonly Located[],
	fetchText: FetchText | undefined,
): Promise<readonly CheckResult[]> {
	const docs = located.filter((item) => item.evidence.kind === "doc");
	if (fetchText === undefined) {
		return docs.map((item) => ({ ...item, status: "skipped" as const, detail: "没有加 --online，只查了形式" }));
	}
	const urls = [...new Set(docs.map((item) => (item.evidence.kind === "doc" ? item.evidence.url : "")))];
	const pages = new Map<string, { text?: string; error?: string }>();
	for (const url of urls) {
		try {
			pages.set(url, { text: normalizeMarkdown(await fetchText(markdownUrlOf(url))) });
		} catch (error) {
			pages.set(url, { error: error instanceof Error ? error.message : String(error) });
		}
	}
	return docs.map((item) => {
		if (item.evidence.kind !== "doc") throw new Error("unreachable");
		const page = pages.get(item.evidence.url);
		if (page?.text === undefined) return { ...item, status: "fail" as const, detail: `抓不到页面：${page?.error ?? "未知错误"}` };
		const quote = normalizeMarkdown(item.evidence.quote);
		return page.text.includes(quote)
			? { ...item, status: "ok" as const, detail: "" }
			: { ...item, status: "fail" as const, detail: "页面里找不到这句原话（文档可能改过）" };
	});
}

export async function verifyAll(roots: Roots, fetchText: FetchText | undefined): Promise<readonly CheckResult[]> {
	const located = collectEvidence();
	const codeResults = located.flatMap((item) =>
		item.evidence.kind === "code" ? [{ where: item.where, ...checkCode(item.evidence, roots) }] : [],
	);
	const docResults = await checkDocs(located, fetchText);
	const manual = located
		.filter((item) => item.evidence.kind === "measured" || item.evidence.kind === "inference")
		.map((item) => ({ ...item, status: "manual" as const, detail: "" }));
	return [...codeResults, ...docResults, ...manual];
}

export function countByStatus(results: readonly CheckResult[]): Readonly<Record<CheckStatus, number>> {
	const count = (status: CheckStatus) => results.filter((result) => result.status === status).length;
	return { ok: count("ok"), fail: count("fail"), skipped: count("skipped"), manual: count("manual") };
}

export function renderResults(results: readonly CheckResult[]): string {
	const counts = countByStatus(results);
	const failures = results
		.filter((result) => result.status === "fail")
		.map((result) => `  ✗ ${result.where}：${formatEvidence(result.evidence)}\n    ${result.detail}`);
	const skipped = [...new Set(results.filter((result) => result.status === "skipped").map((result) => result.detail))].map(
		(detail) => `  - 跳过：${detail}`,
	);
	return [
		`出处 ${results.length} 条：通过 ${counts.ok}，失败 ${counts.fail}，跳过 ${counts.skipped}，需人工复核 ${counts.manual}（实机 / 推断）`,
		...failures,
		...skipped,
	].join("\n");
}
