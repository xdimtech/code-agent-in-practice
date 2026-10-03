/**
 * 第 1 章的分层口径：拿到一个文件的路径和内容，判断它属于哪一层。
 *
 * 为什么需要这么个东西：同一个仓库里，`agent-loop.ts` 和 `interactive-mode.ts`
 * 会以同样的身份出现在 `ls` 的输出里，但换掉它们的代价差两个数量级。
 * 「哪一层」不是靠目录名读出来的，得有一份可以写下来、可以被反驳的规则。
 *
 * 规则有四层，判断顺序是**从下往上**：先看它是不是 provider 适配，
 * 再看是不是循环，再看是不是 harness，剩下的都算产品层。
 * 顺序很重要——产品层在最上面，任何东西最后都会落到它那里，
 * 所以它必须是兜底项，不能是第一个判据。
 */

export type Layer = "provider" | "runtime" | "harness" | "product";

export interface LayerRule {
	readonly layer: Layer;
	readonly why: string;
	/** 路径片段（任一命中即候选）。 */
	readonly pathHits: readonly RegExp[];
	/** 内容特征（任一命中即候选）。用来兜住路径没写全的情况。 */
	readonly contentHits: readonly RegExp[];
}

/**
 * 规则表。每条都写清楚「凭什么这么判」——这是这份表能被讨论的前提。
 * 表里的路径样例取自 pi，但规则本身与 pi 无关：换一个仓库，改样例不改逻辑。
 */
export const LAYER_RULES: readonly LayerRule[] = [
	{
		layer: "provider",
		why: "把某一家的 HTTP 协议翻译成统一的流式消息。换一家只影响这一层，不影响循环。",
		// pi 把这一层拆成两个目录：`ai/src/api/` 放线协议（anthropic-messages.ts 这类），
		// `ai/src/providers/` 放每家的配置和模型清单（anthropic.models.ts 这类）。
		// 厂商自己的登录流程（`auth/oauth/`）也算——换一家就得跟着换。
		pathHits: [
			/(^|\/)(api|providers?)\//i,
			/(^|\/)auth\/oauth\//i,
			/\.models\.ts$/i,
			/models\.generated\.ts$/i,
		],
		contentHits: [/https?:\/\/[a-z0-9.-]+\/v1\//i, /Authorization.*Bearer/i],
	},
	{
		layer: "runtime",
		why: "驱动「模型说话 → 跑工具 → 再说话」的循环本身。它不认识任何具体工具。",
		// 锚在路径段开头：`coding-agent.ts`、`agent-harness.ts` 都不该被当成循环。
		pathHits: [/(^|\/)agent-loop\.ts$/i, /(^|\/)agent\.ts$/i, /\bloop\b/i],
		contentHits: [/stopReason/i, /toolCall/i, /emit\(\{ *type:/],
	},
	{
		layer: "harness",
		why: "给循环接线：上下文从哪拼、哪些工具能跑、会话存哪、什么时候压缩。",
		// 具体工具（read / bash / edit …）算 harness 而不是产品：pi 自己就把
		// 内置工具放在 `agent/src/harness/tools/` 下面。循环不认识它们，
		// 是 harness 把它们挑出来、接进去的。
		pathHits: [
			/harness\//i,
			/(^|\/)tools\//i,
			/sessions?\//i,
			/session-manager|agent-session/i,
			/resource-loader/i,
			/context/i,
			/compaction/i,
			/system-prompt/i,
			/permission/i,
		],
		contentHits: [/systemPrompt/i, /compact/i, /session(Id|Dir|Manager)/i],
	},
	{
		layer: "product",
		why: "兜底层：CLI、交互界面、配置、扩展宿主。用户能看见的一切，和上面三层都不沾的，都在这。",
		pathHits: [/cli\//i, /tui\//i, /ui\//i, /commands?\//i, /config\.ts$/i, /main\.ts$/i],
		contentHits: [/process\.argv/i, /readline/i, /render/i],
	},
];

/** 一个文件被分到哪一层。`hits` 是命中的规则，便于反驳：「你凭什么这么判」。 */
export interface Classification {
	readonly layer: Layer;
	readonly why: string;
	readonly hits: readonly string[];
}

/**
 * 判一个文件。路径特征优先于内容特征——内容特征是为了兜住
 * 「文件名没透露信息」的情况，不是主判据。
 */
export function classifyFile(path: string, content = ""): Classification {
	for (const rule of LAYER_RULES) {
		const pathHit = rule.pathHits.find((re) => re.test(path));
		if (pathHit) {
			return { layer: rule.layer, why: rule.why, hits: [`路径 /${pathHit.source}/`] };
		}
	}
	for (const rule of LAYER_RULES) {
		const contentHit = rule.contentHits.find((re) => re.test(content));
		if (contentHit) {
			return { layer: rule.layer, why: rule.why, hits: [`内容 /${contentHit.source}/`] };
		}
	}
	return { layer: "product", why: LAYER_RULES[3].why, hits: ["兜底：四条规则都没命中"] };
}

export interface LayerTally {
	readonly layer: Layer;
	readonly files: number;
	readonly lines: number;
}

/** 按层汇总。入参是 `[路径, 行数]` 的列表，读磁盘的部分留给调用方。 */
export function tallyLayers(entries: readonly (readonly [string, number])[]): readonly LayerTally[] {
	const order: readonly Layer[] = ["provider", "runtime", "harness", "product"];
	const buckets = new Map<Layer, { files: number; lines: number }>();
	for (const layer of order) buckets.set(layer, { files: 0, lines: 0 });
	for (const [path, lines] of entries) {
		const { layer } = classifyFile(path);
		const bucket = buckets.get(layer);
		if (bucket) {
			bucket.files += 1;
			bucket.lines += lines;
		}
	}
	return order.map((layer) => ({ layer, ...(buckets.get(layer) ?? { files: 0, lines: 0 }) }));
}

/**
 * 换掉一层的代价 = 你要重写多少行。
 *
 * 这不等于工作量：harness 的一行和 provider 的一行不是同一种一行。
 * 它衡量的是一件更窄的事——如果一个下游想「保留其它三层、重写这一层」，
 * 他至少要动多少代码。用行数当代理指标是因为它可复现，不是因为它是答案。
 */
export function replacementCost(tally: readonly LayerTally[]): string {
	const total = tally.reduce((sum, t) => sum + t.lines, 0);
	if (total === 0) return "没有可统计的源码行。";
	const shares = tally
		.filter((t) => t.lines > 0)
		.sort((a, b) => b.lines - a.lines)
		.map((t) => `${t.layer} ${((t.lines / total) * 100).toFixed(1)}%`);
	return `${total} 行；占比 ${shares.join(" / ")}。占比最大的那一层就是重写代价最大的那一层。`;
}
