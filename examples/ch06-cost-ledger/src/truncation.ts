/**
 * 截断的账：一次工具输出截掉多少，之后每一轮都少付多少。
 *
 * 截断规则照抄 pi 的 core/tools/truncate.ts:1-13：行数和字节两条上限，先到先停，不留半行。
 * 这里只实现「保留开头」的那种（read 用的）；bash 保留结尾，规则对称。
 */

import { calculateCost } from "./pricing.ts";
import type { Rates } from "./types.ts";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
/** pi 估算 token 用「字符数 / 4」，自己说是偏高的估计（compaction.ts:266-296） */
export const CHARS_PER_TOKEN = 4;

export interface Truncation {
	readonly content: string;
	readonly truncated: boolean;
	readonly by: "lines" | "bytes" | undefined;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly keptLines: number;
	readonly keptBytes: number;
}

const bytesOf = (s: string) => Buffer.byteLength(s, "utf8");

export function truncateHead(text: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES): Truncation {
	if (!(maxLines > 0) || !(maxBytes > 0)) throw new RangeError("两条上限都必须是正数");
	const lines = text.split("\n");
	const totalBytes = bytesOf(text);
	if (lines.length <= maxLines && totalBytes <= maxBytes) {
		return { content: text, truncated: false, by: undefined, totalLines: lines.length, totalBytes, keptLines: lines.length, keptBytes: totalBytes };
	}
	const kept: string[] = [];
	let bytes = 0;
	let by: Truncation["by"] = "lines";
	for (const line of lines.slice(0, maxLines)) {
		const add = bytesOf(line) + (kept.length > 0 ? 1 : 0);
		if (bytes + add > maxBytes) {
			by = "bytes";
			break;
		}
		kept.push(line);
		bytes += add;
	}
	return { content: kept.join("\n"), truncated: true, by, totalLines: lines.length, totalBytes, keptLines: kept.length, keptBytes: bytes };
}

export interface TruncationSaving {
	readonly droppedTokens: number;
	/** 进上下文那一轮少写的钱 */
	readonly firstTurn: number;
	/** 之后每一轮少读的钱 */
	readonly perLaterTurn: number;
	readonly total: number;
}

/** 截掉的那部分如果留在上下文里，之后 laterTurns 轮都要按缓存读价再付一遍 */
export function truncationSaving(t: Truncation, laterTurns: number, rates: Rates): TruncationSaving {
	if (!(laterTurns >= 0)) throw new RangeError("laterTurns 必须是非负数");
	const droppedTokens = Math.ceil((t.totalBytes - t.keptBytes) / CHARS_PER_TOKEN);
	const firstTurn = calculateCost(rates, { input: 0, output: 0, cacheRead: 0, cacheWrite: droppedTokens }).total;
	const perLaterTurn = calculateCost(rates, { input: 0, output: 0, cacheRead: droppedTokens, cacheWrite: 0 }).total;
	return { droppedTokens, firstTurn, perLaterTurn, total: firstTurn + perLaterTurn * laterTurns };
}
