/**
 * 命令行入口。
 *
 *   cost-ledger ledger [session.jsonl]       会话的账：实际花费、缓存浪费、换缓存策略重算；不给文件就用演示会话
 *   cost-ledger compaction [--reserve N]     压缩的账：参数化长会话，对照「从不压缩」
 *   cost-ledger truncation [--lines N]       截断的账：一次大输出截掉多少、之后每轮少付多少
 *   cost-ledger effort [--new-lines N]       投入的账：六个仓库的代码量与历史能读出什么；给了 N 再反推作者周
 *   cost-ledger measure <repo> [name]        在一个真仓库上量同一套数字（只读，只调 git）
 *   cost-ledger demo                         打印演示会话 JSONL
 *
 * 退出码：0 成功；1 会话里有坏行（账照样算，但少算了）；2 用法或输入有问题。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanWaste } from "./cache-waste.ts";
import { compactionBreakEvenTurns, DEFAULT_SCENARIO, simulateCompaction } from "./compaction.ts";
import { buildDemoSession } from "./demo.ts";
import { estimateAuthorWeeks, readEffort, REPOS } from "./effort.ts";
import { measureRepo } from "./measure.ts";
import { DEMO_PRICES, demoPriceBook } from "./pricing.ts";
import { renderCompaction, renderEffort, renderEstimate, renderPolicies, renderTruncation, renderWaste } from "./report.ts";
import { parseSession } from "./session.ts";
import { truncateHead, truncationSaving } from "./truncation.ts";
import { POLICIES, recorded, replay } from "./what-if.ts";

export const EXIT = { ok: 0, badLines: 1, usage: 2 } as const;

export class UsageError extends Error {}

const SONNET = DEMO_PRICES["anthropic/claude-sonnet-4-5"]!;

/** 取 `--name 数字`；没给就用默认值，给了但不是非负整数就报错 */
export function numberFlag(args: readonly string[], name: string, fallback: number): number {
	const i = args.indexOf(name);
	if (i < 0) return fallback;
	const raw = args[i + 1];
	const n = Number(raw);
	if (raw === undefined || !Number.isInteger(n) || n < 0) throw new UsageError(`${name} 后面要跟一个非负整数，得到「${raw ?? ""}」`);
	return n;
}

export function ledger(text: string): { out: string; code: number } {
	const { entries, problems } = parseSession(text);
	if (entries.length === 0) throw new UsageError("会话里没有一条能算账的助手消息");
	const waste = scanWaste(entries, demoPriceBook);
	const rows = POLICIES.map((p) => replay(entries, p, demoPriceBook));
	const parts = [renderWaste(recorded(entries), waste), renderPolicies(rows)];
	if (problems.length > 0) parts.push(`有 ${problems.length} 行没读进来，上面的数字少算了：\n  ${problems.join("\n  ")}`);
	return { out: parts.join("\n\n"), code: problems.length > 0 ? EXIT.badLines : EXIT.ok };
}

export function compaction(args: readonly string[]): string {
	const scenario = {
		...DEFAULT_SCENARIO,
		reserveTokens: numberFlag(args, "--reserve", DEFAULT_SCENARIO.reserveTokens),
		turns: numberFlag(args, "--turns", DEFAULT_SCENARIO.turns),
		desiredSummaryTokens: numberFlag(args, "--summary", DEFAULT_SCENARIO.desiredSummaryTokens),
	};
	try {
		const r = simulateCompaction(scenario, SONNET);
		const never = simulateCompaction({ ...scenario, compact: false, contextWindow: Number.MAX_SAFE_INTEGER }, SONNET);
		return renderCompaction(scenario, r, never, compactionBreakEvenTurns(scenario, SONNET));
	} catch (error) {
		if (error instanceof RangeError) throw new UsageError(error.message);
		throw error;
	}
}

export function truncation(args: readonly string[]): string {
	const lines = numberFlag(args, "--lines", 12_000);
	const later = numberFlag(args, "--later", 30);
	// 一份典型的大输出：每行 55 字节左右的日志
	const text = Array.from({ length: lines }, (_, i) => `2026-10-05T01:${String(i % 60).padStart(2, "0")}:00Z INFO request ${i} handled in ${i % 97}ms`).join("\n");
	const t = truncateHead(text);
	return renderTruncation(t, truncationSaving(t, later, SONNET), later);
}

export function effort(args: readonly string[] = []): string {
	const rows = REPOS.map((facts) => ({ facts, reading: readEffort(facts) }));
	const newLines = numberFlag(args, "--new-lines", 0);
	const table = renderEffort(rows);
	if (newLines === 0) return table;
	return `${table}\n\n${renderEstimate(newLines, estimateAuthorWeeks(newLines, rows.map((r) => r.reading)))}`;
}

function run(argv: readonly string[]): number {
	const [command, ...rest] = argv;
	switch (command) {
		case "ledger": {
			const text = rest[0] ? readFileSync(rest[0], "utf8") : buildDemoSession();
			const { out, code } = ledger(text);
			console.log(out);
			return code;
		}
		case "compaction":
			console.log(compaction(rest));
			return EXIT.ok;
		case "truncation":
			console.log(truncation(rest));
			return EXIT.ok;
		case "effort":
			console.log(effort(rest));
			return EXIT.ok;
		case "measure": {
			if (!rest[0]) throw new UsageError("measure 要给一个仓库目录");
			console.log(JSON.stringify(measureRepo(resolve(rest[0]), rest[1] ?? rest[0]), null, 2));
			return EXIT.ok;
		}
		case "demo":
			process.stdout.write(buildDemoSession());
			return EXIT.ok;
		default:
			throw new UsageError(`用法：cost-ledger ledger|compaction|truncation|effort|measure|demo（得到「${command ?? ""}」）`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof UsageError ? error.message : error instanceof Error && "code" in error && error.code === "ENOENT" ? `读不到文件：${(error as Error).message}` : undefined;
		if (message === undefined) throw error;
		console.error(`cost-ledger：${message}`);
		process.exitCode = EXIT.usage;
	}
}
