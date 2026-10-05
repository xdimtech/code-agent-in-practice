/**
 * 生成演示会话：一个 Sonnet 会话，18 轮，中间故意放进四件会让缓存失效的事：
 * 一次 12 分钟的停顿、一次换到 Opus 再换回来、一次压缩、一次漏得很少（低于噪声门槛）。
 * 每一轮的 usage 都按「真实 provider 会怎么报」来造：命中多少由上一轮决定，cost 用 calculateCost 现算。
 */

import { DEMO_PRICES, makeUsage } from "./pricing.ts";
import type { Usage } from "./types.ts";

const START = Date.parse("2026-10-05T01:00:00.000Z");
const SYSTEM = 9_000;

interface Step {
	/** 距离上一轮的秒数 */
	readonly gap: number;
	/** 这一轮新增进 prompt 的 token */
	readonly growth: number;
	readonly output: number;
	readonly model?: "claude-opus-4-5";
	/** 服务端少命中的 token（断点粒度造成的小漏） */
	readonly jitter?: number;
	readonly compactAfter?: true;
}

const STEPS: readonly Step[] = [
	{ gap: 0, growth: 0, output: 300 },
	{ gap: 20, growth: 3_000, output: 250 },
	{ gap: 25, growth: 6_500, output: 400 },
	{ gap: 18, growth: 2_200, output: 200 },
	{ gap: 30, growth: 8_000, output: 600, jitter: 700 },
	{ gap: 720, growth: 1_500, output: 300 }, // 12 分钟没动，5 分钟的缓存过期了
	{ gap: 22, growth: 4_000, output: 350 },
	{ gap: 40, growth: 5_000, output: 500 },
	{ gap: 15, growth: 2_000, output: 800, model: "claude-opus-4-5" }, // 换模型：缓存按模型分开
	{ gap: 35, growth: 3_000, output: 400, model: "claude-opus-4-5" },
	{ gap: 20, growth: 2_500, output: 300 }, // 换回来：Sonnet 的缓存还在，但 Opus 那两轮新增的部分它没见过
	{ gap: 25, growth: 7_000, output: 450 },
	{ gap: 30, growth: 6_000, output: 500, compactAfter: true },
	{ gap: 50, growth: 2_000, output: 300 }, // 压缩后：上下文本来就变了，不算浪费
	{ gap: 20, growth: 3_500, output: 350 },
	{ gap: 25, growth: 2_800, output: 300 },
	{ gap: 30, growth: 4_200, output: 400 },
	{ gap: 18, growth: 1_800, output: 250 },
];

const SUMMARY_TOKENS = 6_000;
const KEEP_RECENT = 12_000;

export const DEMO_TURNS = STEPS.length;

export function buildDemoSession(): string {
	const lines: string[] = [JSON.stringify({ type: "session", version: 3, id: "0199b0c0-demo-7000-8000-cost00000001", timestamp: new Date(START).toISOString(), cwd: "/work/shop" })];
	type State = { at: number; context: number; cached: Record<string, { tokens: number; at: number }>; parent: string | null };
	STEPS.reduce<State>(
		(st, step, i) => {
			const at = st.at + step.gap * 1000;
			const model = step.model ?? "claude-sonnet-4-5";
			const prompt = st.context + step.growth;
			const prev = st.cached[model];
			const alive = prev !== undefined && at - prev.at <= 5 * 60 * 1000;
			const hit = alive ? Math.max(0, Math.min(prev.tokens, prompt) - (step.jitter ?? 0)) : 0;
			const usage: Usage = makeUsage(DEMO_PRICES[`anthropic/${model}`]!, { input: 0, output: step.output, cacheRead: hit, cacheWrite: prompt - hit });
			const id = `a${String(i + 1).padStart(2, "0")}`;
			lines.push(
				JSON.stringify({
					type: "message",
					id,
					parentId: st.parent,
					timestamp: new Date(at).toISOString(),
					message: { role: "assistant", content: [{ type: "text", text: `第 ${i + 1} 轮` }], api: "anthropic-messages", provider: "anthropic", model, usage, stopReason: "toolUse", timestamp: at },
				}),
			);
			const afterTurn: State = { at, context: prompt + step.output, cached: { ...st.cached, [model]: { tokens: prompt, at } }, parent: id };
			if (!step.compactAfter) return afterTurn;
			const summarized = afterTurn.context - SYSTEM - KEEP_RECENT;
			const summaryUsage = makeUsage(DEMO_PRICES["anthropic/claude-sonnet-4-5"]!, { input: summarized, output: SUMMARY_TOKENS, cacheRead: 0, cacheWrite: 0 });
			const cid = `c${String(i + 1).padStart(2, "0")}`;
			lines.push(JSON.stringify({ type: "compaction", id: cid, parentId: id, timestamp: new Date(at + 1000).toISOString(), summary: "（摘要正文略）", firstKeptEntryId: id, tokensBefore: afterTurn.context, usage: summaryUsage }));
			// 压缩之后只有 system 头部还在缓存里
			return { at: at + 1000, context: SYSTEM + SUMMARY_TOKENS + KEEP_RECENT, cached: { [model]: { tokens: SYSTEM, at: at + 1000 } }, parent: cid };
		},
		{ at: START, context: SYSTEM, cached: {}, parent: null },
	);
	return `${lines.join("\n")}\n`;
}

