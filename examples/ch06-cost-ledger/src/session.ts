/**
 * 读 pi 的会话 JSONL，只留下算账用得上的三种条目。
 *
 * 会话文件是外部数据：一行坏了只记一条问题、跳过这一行，不让整份账算不出来。
 * 字段缺了或类型不对，也算坏行——算钱的地方宁可少算一条，不能把 NaN 加进总数。
 */

import type { AssistantTurn, LedgerEntry, Usage } from "./types.ts";

export interface ParseResult {
	readonly entries: readonly LedgerEntry[];
	readonly problems: readonly string[];
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

/** 校验并取出 usage；不合格返回原因字符串 */
export function readUsage(raw: unknown): Usage | string {
	if (!isObject(raw)) return "usage 不是对象";
	for (const key of TOKEN_KEYS) if (!isCount(raw[key])) return `usage.${key} 不是非负数`;
	if (raw.cacheWrite1h !== undefined && !isCount(raw.cacheWrite1h)) return "usage.cacheWrite1h 不是非负数";
	const cost = raw.cost;
	if (!isObject(cost)) return "usage.cost 不是对象";
	for (const key of COST_KEYS) if (!isCount(cost[key])) return `usage.cost.${key} 不是非负数`;
	const tokens = TOKEN_KEYS.map((k) => raw[k] as number);
	return {
		input: tokens[0]!,
		output: tokens[1]!,
		cacheRead: tokens[2]!,
		cacheWrite: tokens[3]!,
		...(raw.cacheWrite1h === undefined ? {} : { cacheWrite1h: raw.cacheWrite1h as number }),
		totalTokens: isCount(raw.totalTokens) ? raw.totalTokens : tokens.reduce((a, b) => a + b, 0),
		cost: { input: cost.input as number, output: cost.output as number, cacheRead: cost.cacheRead as number, cacheWrite: cost.cacheWrite as number, total: cost.total as number },
	};
}

function readAssistant(id: string, m: Json): AssistantTurn | string {
	if (typeof m.provider !== "string" || typeof m.model !== "string") return "assistant 缺 provider 或 model";
	if (!isCount(m.timestamp)) return "assistant 缺 timestamp";
	const usage = readUsage(m.usage);
	if (typeof usage === "string") return usage;
	return { id, provider: m.provider, model: m.model, usage, timestamp: m.timestamp };
}

/** 一行 → 条目；与算账无关的行返回 undefined，坏行返回原因 */
export function readLine(line: string): LedgerEntry | string | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(line);
	} catch {
		return "不是合法 JSON";
	}
	if (!isObject(raw)) return "不是 JSON 对象";
	const id = typeof raw.id === "string" ? raw.id : "?";
	if (raw.type === "message" && isObject(raw.message) && raw.message.role === "assistant") {
		const turn = readAssistant(id, raw.message);
		return typeof turn === "string" ? turn : { kind: "assistant", turn };
	}
	if (raw.type === "compaction" || raw.type === "branch_summary") {
		const usage = raw.usage === undefined ? undefined : readUsage(raw.usage);
		if (typeof usage === "string") return usage;
		if (raw.type === "branch_summary") return { kind: "branch_summary", id, ...(usage ? { usage } : {}) };
		if (!isCount(raw.tokensBefore)) return "compaction 缺 tokensBefore";
		return { kind: "compaction", id, tokensBefore: raw.tokensBefore, ...(usage ? { usage } : {}) };
	}
	return undefined;
}

export function parseSession(text: string): ParseResult {
	const entries: LedgerEntry[] = [];
	const problems: string[] = [];
	text.split("\n").forEach((line, index) => {
		if (line.trim() === "") return;
		const result = readLine(line);
		if (typeof result === "string") problems.push(`第 ${index + 1} 行：${result}`);
		else if (result) entries.push(result);
	});
	return { entries, problems };
}
