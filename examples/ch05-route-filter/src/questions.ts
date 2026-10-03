/**
 * 硬约束问题与规则。
 *
 * 问题只问「不能让步」的条件：答案一旦是某个值，就能直接排除一条路线，或者给它加一项必须自己扛的事。
 * 「更喜欢哪种语言」「团队熟不熟」这类偏好不在这里——偏好可以让步，规则不该替你让步。
 *
 * 规则全是数据：一条路线、一组条件（且）、一个效果、一句理由、出处。filter.ts 只负责对表。
 */

import { code, doc, DOCS, inference } from "./evidence.ts";
import type { Question, QuestionId, Rule } from "./types.ts";

export const QUESTIONS: readonly Question[] = [
	{
		id: "models",
		prompt: "要接哪些模型？",
		options: { claude: "只用 Claude", openai: "只用 OpenAI 系（Responses API）", mixed: "混用，或者有国内 / 自部署模型" },
	},
	{
		id: "host",
		prompt: "宿主程序用什么语言写？",
		options: { node: "Node / TypeScript", python: "Python", other: "其他（Go、Java、Rust……）" },
	},
	{
		id: "session-process",
		prompt: "能不能接受每个会话背后挂一个常驻子进程？",
		options: { yes: "可以（自己的机器、容器、按会话起实例）", no: "不行（Serverless、一个进程服务很多会话）" },
	},
	{
		id: "approval",
		prompt: "第一天就要有现成的工具审批流程、不想自己写吗？",
		options: { yes: "要现成的", no: "可以自己写，或者不需要" },
	},
	{
		id: "sandbox",
		prompt: "要 harness 自己带操作系统级沙箱吗？",
		options: { yes: "要 harness 自带", no: "外面套容器 / 虚拟机就行" },
	},
	{
		id: "loop",
		prompt: "要不要改循环本身（不只是加工具、加钩子）？",
		options: { yes: "要改", no: "不改" },
	},
	{
		id: "upstream",
		prompt: "你的修复必须能合回上游吗？",
		options: { yes: "必须，不想长期背补丁", no: "不必，可以自己维护分叉" },
	},
	{
		id: "license",
		prompt: "harness 本身必须是 OSI 开源许可、可以随产品再分发吗？",
		options: { yes: "必须", no: "商业条款也能接受" },
	},
];

export function questionOf(id: QuestionId): Question {
	const found = QUESTIONS.find((q) => q.id === id);
	if (found === undefined) throw new Error(`没有这个问题：${id}`);
	return found;
}

const PI_README = "packages/coding-agent/README.md";

export const RULES: readonly Rule[] = [
	// ── 模型 ──
	{
		route: "agent-sdk",
		when: { models: ["openai", "mixed"] },
		effect: "exclude",
		reason: "Claude Code 不支持经网关路由到非 Claude 模型",
		evidence: [doc(DOCS.llmGateway, "doesn't support routing Claude Code to non-Claude models through any gateway")],
	},
	{
		route: "fork-codex",
		when: { models: ["claude", "mixed"] },
		effect: "obligation",
		reason: "codex 只说 Responses API（chat 线协议已删），非 OpenAI 模型要你自己写一层转换或改 provider 代码",
		evidence: [
			code("codex", "codex-rs/model-provider-info/src/lib.rs", 103, 107, "Responses,"),
			code("codex", "codex-rs/model-provider-info/src/lib.rs", 96, 96, "is no longer supported"),
		],
	},
	{
		route: "direct-api",
		when: { models: ["openai", "mixed"] },
		effect: "obligation",
		reason: "每家一个适配器，流式、工具调用、用量统计的格式都要你自己对齐；pi 这一层有 23,668 行",
		evidence: [code("book", "book/01-choosing/ch02-what-is-pi.md", 239, 239, "23,668")],
	},
	// ── 宿主语言 ──
	{
		route: "pi",
		when: { host: ["python", "other"] },
		effect: "obligation",
		reason: "进程内嵌入只有 Node；其他宿主要用 --mode rpc 起子进程，自己管它的生命周期",
		evidence: [
			code("pi", "packages/coding-agent/src/core/sdk.ts", 173, 173, "export async function createAgentSession("),
			code("pi", PI_README, 547, 547, "--mode rpc"),
		],
	},
	{
		route: "agent-sdk",
		when: { host: ["other"] },
		effect: "obligation",
		reason: "没有你这门语言的 SDK，只能把 CLI 当子进程跑、自己解析 JSON 输出",
		evidence: [doc(DOCS.overview, "run the CLI as a subprocess with the `-p` flag and `--output-format json`")],
	},
	// ── 进程模型 ──
	{
		route: "agent-sdk",
		when: { "session-process": ["no"] },
		effect: "exclude",
		reason: "一个会话就是一个 claude 子进程",
		evidence: [doc(DOCS.hosting, "One agent session maps to one subprocess.")],
	},
	{
		route: "fork-codex",
		when: { "session-process": ["no"] },
		effect: "exclude",
		reason: "官方 SDK 都是起 CLI 子进程；不起子进程就只剩在 Rust 宿主里直接链接 crate 一条路",
		evidence: [
			code("codex", "sdk/typescript/README.md", 5, 5, "spawns the CLI"),
			inference("Rust 宿主可以把 codex-rs 的 crate 当依赖，但那等于宿主本身就在 fork 里，不再是「用 SDK」；本书没有实际这样集成过"),
		],
	},
	{
		route: "pi",
		when: { host: ["python", "other"], "session-process": ["no"] },
		effect: "exclude",
		reason: "非 Node 宿主只能走 RPC 子进程，而你不接受子进程",
		evidence: [code("pi", PI_README, 547, 547, "--mode rpc")],
	},
	// ── 审批 ──
	{
		route: "pi",
		when: { approval: ["yes"] },
		effect: "exclude",
		reason: "pi 明确不做审批弹窗，让你用扩展自己写",
		evidence: [code("pi", PI_README, 503, 503, "No permission popups.")],
	},
	{
		route: "direct-api",
		when: { approval: ["yes"] },
		effect: "exclude",
		reason: "要人工审批时，官方文档让你放下工具运行器、改用手写循环——也就是自己写",
		evidence: [doc(DOCS.toolRunner, "When you need human-in-the-loop approval, custom logging, or conditional execution, use the manual loop instead.")],
	},
	// ── 沙箱 ──
	{
		route: "pi",
		when: { sandbox: ["yes"] },
		effect: "exclude",
		reason: "pi 明确不带沙箱，让你跑在容器或虚拟机里",
		evidence: [code("pi", "packages/coding-agent/docs/security.md", 33, 35, "Pi does not include a built-in sandbox.")],
	},
	{
		route: "direct-api",
		when: { sandbox: ["yes"] },
		effect: "exclude",
		reason: "自己写的循环里没有沙箱，除非你自己写一个",
		evidence: [inference("模型 API 只返回工具调用，工具在哪里、以什么权限执行完全由你的代码决定")],
	},
	{
		route: "agent-sdk",
		when: { sandbox: ["yes"] },
		effect: "obligation",
		reason: "有沙箱，但只管 shell 命令、默认关闭；文件工具、MCP、钩子都在沙箱外。要打开它，并且仍按文档建议套容器",
		evidence: [
			doc(DOCS.sandboxing, "The sandbox covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it."),
			doc(DOCS.sandboxing, "The sandbox is off by default."),
			doc(DOCS.hosting, "Run the SDK inside a sandboxed container for process isolation, resource limits, network control, and an ephemeral filesystem."),
		],
	},
	// ── 改循环 ──
	{
		route: "agent-sdk",
		when: { loop: ["yes"] },
		effect: "exclude",
		reason: "循环在 Claude Code 二进制里，SDK 只给选项和钩子",
		evidence: [doc(DOCS.overview, "A library that runs the Claude Code binary")],
	},
	{
		route: "fork-codex",
		when: { loop: ["yes"] },
		effect: "obligation",
		reason: "run_turn 所在的文件 3,167 行，和工作目录、.git、权限档位长在一起；上游每月上千个 commit，冲突是常态",
		evidence: [
			code("codex", "codex-rs/core/src/session/turn.rs", 163, 163, "async fn run_turn("),
			code("codex", "codex-rs/core/src/session/turn.rs", 826, 839, '".git"'),
		],
	},
	{
		route: "pi",
		when: { loop: ["yes"] },
		effect: "obligation",
		reason: "内核只有 794 行，但改了就是自己的分叉；Step-Code 的 +39 行就是这样留下来的",
		evidence: [
			code("book", "research/BASELINE.md", 89, 89, "794 行"),
			code("book", "book/01-choosing/ch02-what-is-pi.md", 239, 239, "+39"),
		],
	},
	// ── 回上游 ──
	{
		route: "fork-codex",
		when: { upstream: ["yes"] },
		effect: "exclude",
		reason: "codex 不接受外部代码贡献",
		evidence: [code("codex", "docs/contributing.md", 5, 5, "We do not accept external code contributions or pull requests.")],
	},
	{
		route: "agent-sdk",
		when: { upstream: ["yes"] },
		effect: "exclude",
		reason: "你改不到二进制，修复只能等官方发版",
		evidence: [doc(DOCS.hosting, "The bundled binary is pinned to the SDK package version, so updating the SDK is how you update the CLI.")],
	},
	{
		route: "pi",
		when: { upstream: ["yes"] },
		effect: "obligation",
		reason: "新贡献者的 PR 默认自动关闭，要先建立联系；minimax-code 的 38 条补丁里 35 条没开 PR",
		evidence: [
			code("pi", "README.md", 11, 11, "auto-closed by default"),
			code("book", "book/04-shipping/ch24-upstream-strategy.md", 364, 364, "台账 38 条，35 条写明没开上游 PR"),
		],
	},
	// ── 许可 ──
	{
		route: "agent-sdk",
		when: { license: ["yes"] },
		effect: "exclude",
		reason: "受 Anthropic 商业服务条款约束，不是 OSI 开源许可",
		evidence: [doc(DOCS.overview, "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service")],
	},
	{
		route: "fork-codex",
		when: { license: ["yes"] },
		effect: "obligation",
		reason: "Apache-2.0：分发时附许可证与 NOTICE，改过的文件要标明",
		evidence: [code("codex", "LICENSE", 1, 2, "Apache License"), code("codex", "LICENSE", 97, 98, "modified files")],
	},
	{
		route: "pi",
		when: { license: ["yes"] },
		effect: "obligation",
		reason: "MIT：分发时保留版权与许可声明",
		evidence: [code("pi", "LICENSE", 1, 1, "MIT License")],
	},
];
