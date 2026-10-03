/**
 * 出处的构造函数与公开文档的地址。
 *
 * Claude Agent SDK 一侧只引公开文档：本书不读它的源码，所以那一列的每一条都是一个 URL 加一句原话。
 * 原话照抄英文，不翻译——翻译过的引文没法拿去和原页面逐字比对。
 */

import type { CodeEvidence, DocEvidence, Evidence, Repo } from "./types.ts";

export const DOCS = {
	overview: "https://code.claude.com/docs/en/agent-sdk/overview",
	agentLoop: "https://code.claude.com/docs/en/agent-sdk/agent-loop",
	hosting: "https://code.claude.com/docs/en/agent-sdk/hosting",
	sandboxing: "https://code.claude.com/docs/en/sandboxing",
	llmGateway: "https://code.claude.com/docs/en/llm-gateway",
	toolRunner: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner",
} as const;

/** 文档的抓取日期。文档没有 commit，只能写「哪天看到的」 */
export const DOCS_FETCHED = "2026-10-04";

export function code(repo: Repo, path: string, from: number, to: number, needle: string): CodeEvidence {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
		throw new Error(`行号区间不合法：${path}:${from}-${to}`);
	}
	if (needle.trim() === "") throw new Error(`${path}:${from} 的 needle 不能是空的：空串在哪一行都能找到，等于没核对`);
	return { kind: "code", repo, path, lines: [from, to], needle };
}

export function doc(url: string, quote: string): DocEvidence {
	if (!url.startsWith("https://")) throw new Error(`文档地址要是 https：${url}`);
	if (quote.trim() === "") throw new Error(`${url} 的引文不能是空的`);
	return { kind: "doc", url, quote };
}

export function measured(command: string, value: string): Evidence {
	return { kind: "measured", command, value };
}

export function inference(basis: string): Evidence {
	return { kind: "inference", basis };
}

/** 正文用的证据标签 */
export function tagOf(evidence: Evidence): string {
	switch (evidence.kind) {
		case "code":
			return "代码事实";
		case "doc":
			return "文档";
		case "measured":
			return "实机";
		case "inference":
			return "推断";
	}
}

/** 一行能读的出处：`pi:packages/x.ts:3-5`、URL、命令、推断依据 */
export function formatEvidence(evidence: Evidence): string {
	switch (evidence.kind) {
		case "code": {
			const [from, to] = evidence.lines;
			const range = from === to ? `${from}` : `${from}-${to}`;
			return `【代码事实】${evidence.repo}:${evidence.path}:${range}`;
		}
		case "doc":
			return `【文档】${evidence.url}「${evidence.quote}」`;
		case "measured":
			return `【实机】${evidence.command} → ${evidence.value}`;
		case "inference":
			return `【推断】${evidence.basis}`;
	}
}
