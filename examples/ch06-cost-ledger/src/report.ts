/**
 * 把各个模块的结果排成给人看的文本。只做格式，不做计算。
 */

import { isNoticeWorthy, type WasteReport } from "./cache-waste.ts";
import type { CompactionResult, CompactionScenario } from "./compaction.ts";
import type { EffortEstimate, EffortReading, RepoFacts } from "./effort.ts";
import type { TruncationSaving, Truncation } from "./truncation.ts";
import type { PolicyCost } from "./what-if.ts";

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
export const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const REASON: Record<string, string> = { "model-switch": "换了模型", idle: "空闲超过 5 分钟", unknown: "原因不明" };

export function renderWaste(recordedTotal: number, w: WasteReport): string {
	const lines = [`会话实际花费 ${usd(recordedTotal)}；其中缓存浪费 ${int(w.missedTokens)} token、${usd(w.missedCost)}（${pct(w.missedCost / recordedTotal)}）`];
	for (const m of w.misses) {
		const flag = isNoticeWorthy(m) ? "  ← pi 会在对话里提示" : "";
		lines.push(`  ${m.turnId}  ${int(m.missedTokens).padStart(7)} token  ${usd(m.missedCost).padStart(8)}  ${REASON[m.reason]}${flag}`);
	}
	if (w.belowNoiseFloor > 0) lines.push(`  另有 ${w.belowNoiseFloor} 轮漏得不到 1,024 token，算断点粒度噪声，不计`);
	return lines.join("\n");
}

export function renderPolicies(rows: readonly PolicyCost[]): string {
	const base = rows.find((r) => r.policy === "none")?.total ?? rows[0]!.total;
	const lines = ["同一份会话换缓存策略重算（按 prompt 大小与时间戳推，不看实际命中）："];
	for (const r of rows) {
		lines.push(`  ${r.policy.padEnd(5)} 输入 ${usd(r.prompt).padStart(8)}  输出 ${usd(r.output).padStart(8)}  摘要 ${usd(r.summaries).padStart(8)}  合计 ${usd(r.total).padStart(8)}  相对不缓存 ${pct(r.total / base).padStart(6)}  整段重写 ${r.rewrites} 次`);
	}
	return lines.join("\n");
}

export function renderCompaction(s: CompactionScenario, r: CompactionResult, noCompact: CompactionResult, breakEvenTurns: number): string {
	return [
		`场景：窗口 ${int(s.contextWindow)}、预留 ${int(s.reserveTokens)}、保留最近 ${int(s.keepRecentTokens)}，${s.turns} 轮，每轮 +${int(s.growthPerTurn)}`,
		`  压缩 ${r.compactions} 次，摘要撞上 0.8 × 预留 的上限 ${r.summariesCapped} 次${r.summariesCapped > 0 ? "（pi 会判这几次失败，这里按截断照用算，偏乐观）" : ""}；prompt 峰值 ${int(r.peakPrompt)}`,
		`  每轮调用 ${usd(r.turnCost)} + 摘要请求 ${usd(r.summaryCost)} = ${usd(r.total)}（其中压缩后整段重写的溢价 ${usd(r.rewritePremium)}）`,
		`  反事实：窗口无限、从不压缩 ${usd(noCompact.total)}，prompt 峰值 ${int(noCompact.peakPrompt)}`,
		`  一次压缩要再过约 ${breakEvenTurns.toFixed(1)} 轮才回本：之前的每一轮都比不压缩更贵`,
	].join("\n");
}

export function renderTruncation(t: Truncation, s: TruncationSaving, laterTurns: number): string {
	return [
		`一次 ${int(t.totalLines)} 行、${int(t.totalBytes)} 字节的工具输出：按${t.by === "bytes" ? "字节" : "行数"}上限截到 ${int(t.keptLines)} 行、${int(t.keptBytes)} 字节`,
		`  少进上下文约 ${int(s.droppedTokens)} token：当轮少写 ${usd(s.firstTurn)}，之后每轮少读 ${usd(s.perLaterTurn)}，${laterTurns} 轮合计 ${usd(s.total)}`,
	].join("\n");
}

export function renderEffort(rows: readonly { facts: RepoFacts; reading: EffortReading }[]): string {
	const lines = ["仓库              源码行    非 pi 行  最大单次占比  历史          commit   作者周  每作者周新增  删/增"];
	for (const { facts: f, reading: r } of rows) {
		const tail = r.history === "usable" ? `${int(r.addedPerAuthorWeek!).padStart(12)}  ${pct(r.churn!).padStart(6)}` : `${"—".padStart(12)}  ${"—".padStart(6)}`;
		lines.push(`  ${f.name.padEnd(16)}${int(f.lines).padStart(9)}  ${int(r.ownLines).padStart(9)}  ${pct(r.importShare).padStart(11)}  ${(r.history === "usable" ? "可用" : "只是投影").padEnd(10)}${int(f.commits).padStart(8)}  ${int(f.authorWeeks).padStart(6)}  ${tail}`);
	}
	return lines.join("\n");
}

export function renderEstimate(newLines: number, estimates: readonly EffortEstimate[]): string {
	const lines = [`写出 ${int(newLines)} 行新代码，按各段可用历史的净增速度要多少作者周（推断，不是报价）：`];
	for (const e of estimates) lines.push(`  按 ${e.basis.padEnd(16)}${e.authorWeeks.toFixed(1).padStart(8)} 作者周`);
	return lines.join("\n");
}
