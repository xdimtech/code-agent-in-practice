/**
 * 命令行。
 *
 *   facts              四条路线 × 八个维度的对照表（Markdown），每格后面跟出处编号
 *   questions          八个硬约束问题和选项
 *   filter --models mixed --host python …   按你的回答排除路线、列出义务
 *   verify [--sources <dir>] [--online]     核对表里的每一条出处
 *
 * 公共选项：--json 输出机器可读的结果；filter 加 --brief 不打印出处。
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatEvidence } from "./evidence.ts";
import { filterRoutes, validateAnswers } from "./filter.ts";
import { QUESTIONS, RULES } from "./questions.ts";
import { ROUTES } from "./routes.ts";
import type { Answers, Finding, Verdict } from "./types.ts";
import { DIMENSIONS } from "./types.ts";
import type { FetchText } from "./verify.ts";
import { countByStatus, findBookRoot, renderResults, rootsFrom, verifyAll } from "./verify.ts";

const COMMANDS = ["facts", "questions", "filter", "verify"] as const;
type Command = (typeof COMMANDS)[number];

/** 不带值的开关 */
const SWITCHES = new Set(["json", "brief", "online"]);
/** 带值、但不是问题的选项 */
const VALUED = new Set(["sources"]);

export interface Options {
	readonly command: Command;
	readonly json: boolean;
	readonly brief: boolean;
	readonly online: boolean;
	readonly sources: string | undefined;
	/** 其余的 --key value 都当作问题的回答，交给 validateAnswers 去查 */
	readonly answers: Readonly<Record<string, string>>;
}

export const USAGE = `用法：
  node --experimental-strip-types src/main.ts facts [--json]
  node --experimental-strip-types src/main.ts questions [--json]
  node --experimental-strip-types src/main.ts filter --<问题> <选项> … [--brief] [--json]
  node --experimental-strip-types src/main.ts verify [--sources <放着 pi/ 和 codex/ 的目录>] [--online] [--json]

问题：${QUESTIONS.map((q) => `--${q.id} ${Object.keys(q.options).join("|")}`).join("  ")}`;

export function parseArgs(argv: readonly string[]): Options {
	const [command, ...rest] = argv;
	if (command === undefined || !(COMMANDS as readonly string[]).includes(command)) {
		throw new Error(`第一个参数要是 ${COMMANDS.join(" / ")} 之一，收到「${command ?? ""}」\n\n${USAGE}`);
	}
	const switches = new Set<string>();
	const values: Record<string, string> = {};
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index] ?? "";
		if (!token.startsWith("--") || token.length <= 2) throw new Error(`看不懂的参数：「${token}」`);
		const key = token.slice(2);
		if (SWITCHES.has(key)) {
			switches.add(key);
			continue;
		}
		const value = rest[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`--${key} 后面要跟一个值`);
		if (Object.hasOwn(values, key)) throw new Error(`--${key} 给了两次`);
		values[key] = value;
		index += 1;
	}
	const answers = Object.fromEntries(Object.entries(values).filter(([key]) => !VALUED.has(key)));
	if (command !== "filter" && Object.keys(answers).length > 0) {
		throw new Error(`${command} 不接受问题的回答：${Object.keys(answers).map((key) => `--${key}`).join(" ")}`);
	}
	return {
		command: command as Command,
		json: switches.has("json"),
		brief: switches.has("brief"),
		online: switches.has("online"),
		sources: values.sources ?? process.env.CODE_AGENTS_DIR,
		answers,
	};
}

/** Markdown 表格里的一格：竖线要转义，否则会把表格切开 */
function cell(text: string): string {
	return text.replaceAll("|", "\\|");
}

export function renderFacts(): string {
	const header = `| 维度 | ${ROUTES.map((route) => route.name).join(" | ")} |`;
	const divider = `| --- | ${ROUTES.map(() => "---").join(" | ")} |`;
	const rows = DIMENSIONS.map(
		(dimension) => `| ${dimension.label} | ${ROUTES.map((route) => cell(route.facts[dimension.id].text)).join(" | ")} |`,
	);
	const sources = ROUTES.flatMap((route) =>
		DIMENSIONS.map((dimension) => {
			const lines = route.facts[dimension.id].evidence.map((evidence) => `    ${formatEvidence(evidence)}`);
			return [`  ${route.name} / ${dimension.label}`, ...lines].join("\n");
		}),
	);
	return [header, divider, ...rows, "", "出处：", ...sources].join("\n");
}

export function renderQuestions(): string {
	return QUESTIONS.map((question) => {
		const options = Object.entries(question.options).map(([value, label]) => `    ${value.padEnd(6)} ${label}`);
		const rules = RULES.filter((rule) => Object.hasOwn(rule.when, question.id)).length;
		return [`--${question.id}  ${question.prompt}（${rules} 条规则）`, ...options].join("\n");
	}).join("\n");
}

function renderFinding(finding: Finding, brief: boolean): string {
	const tag = finding.questions.length === 0 ? "路线自带" : finding.questions.join("+");
	const head = `    · [${tag}] ${finding.reason}`;
	if (brief) return head;
	return [head, ...finding.evidence.map((evidence) => `        ${formatEvidence(evidence)}`)].join("\n");
}

export function renderVerdicts(answers: Answers, verdicts: readonly Verdict[], brief: boolean): string {
	const answered = QUESTIONS.filter((q) => answers[q.id] !== undefined).map((q) => `${q.id}=${answers[q.id]}`);
	const unanswered = QUESTIONS.filter((q) => answers[q.id] === undefined).map((q) => q.id);
	const blocks = verdicts.map((verdict) => {
		if (verdict.status === "excluded") {
			return [`✗ ${verdict.route.name}：排除`, ...verdict.exclusions.map((finding) => renderFinding(finding, brief))].join("\n");
		}
		return [
			`✓ ${verdict.route.name}：可选，要自己扛 ${verdict.obligations.length} 件事`,
			...verdict.obligations.map((finding) => renderFinding(finding, brief)),
		].join("\n");
	});
	const viable = verdicts.filter((verdict) => verdict.status === "viable").length;
	const footer =
		viable === 0
			? "四条都被排除了：至少有一个约束要让步，或者你要找的路线不在这四条里。"
			: `留下 ${viable} 条。顺序是固定的，不是名次——谁更合适，看义务清单里哪些是你本来就打算做的。`;
	return [
		`回答：${answered.length === 0 ? "（无）" : answered.join(" ")}`,
		...(unanswered.length === 0 ? [] : [`没回答：${unanswered.join(" ")}（没回答的问题不会排除任何路线）`]),
		"",
		...blocks,
		"",
		footer,
	].join("\n");
}

async function fetchMarkdown(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.text();
}

export async function main(argv: readonly string[], fetchText: FetchText = fetchMarkdown): Promise<number> {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	const options = parseArgs(argv);
	switch (options.command) {
		case "facts":
			console.log(options.json ? JSON.stringify(ROUTES, null, 2) : renderFacts());
			return 0;
		case "questions":
			console.log(options.json ? JSON.stringify({ questions: QUESTIONS, rules: RULES }, null, 2) : renderQuestions());
			return 0;
		case "filter": {
			const answers = validateAnswers(options.answers);
			const verdicts = filterRoutes(answers);
			console.log(options.json ? JSON.stringify({ answers, verdicts }, null, 2) : renderVerdicts(answers, verdicts, options.brief));
			return 0;
		}
		case "verify": {
			const bookRoot = findBookRoot(fileURLToPath(new URL(".", import.meta.url)));
			const roots = rootsFrom(bookRoot, options.sources);
			const results = await verifyAll(roots, options.online ? fetchText : undefined);
			console.log(options.json ? JSON.stringify({ counts: countByStatus(results), results }, null, 2) : renderResults(results));
			return countByStatus(results).fail > 0 ? 1 : 0;
		}
	}
}

// 直接 node src/main.ts 时 argv[1] 就是本文件；被测试 import 时不是。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		},
	);
}
