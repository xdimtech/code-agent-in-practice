/**
 * 四条路线的事实。
 *
 * 每条陈述都要带出处：code 指向 BASELINE.md 锁定的 commit 里的某几行（verify 会核对 needle），
 * doc 是公开文档的一句原话，measured 是一条量出来的命令，inference 写明推的依据。
 * 出处为空的陈述在测试里会红——这张表的意义全在出处上。
 */

import { code, doc, DOCS, inference, measured } from "./evidence.ts";
import type { Route, RouteId } from "./types.ts";

const directApi: Route = {
	id: "direct-api",
	name: "直接调模型 API，自己写循环",
	summary: "第 1 章那 221 行的循环，或者客户端 SDK 里的 beta 工具运行器；harness 的每一层都是你的代码",
	facts: {
		runtime: {
			text: "任何能发 HTTP 的语言；官方工具运行器（beta）有 7 种语言的 SDK",
			evidence: [doc(DOCS.toolRunner, "The tool runner is in beta and available in the Python SDK, TypeScript SDK, C# SDK, Go SDK, Java SDK, PHP SDK, and Ruby SDK.")],
		},
		license: {
			text: "代码是你自己的；只受模型服务条款约束",
			evidence: [inference("没有引入任何第三方 harness，许可问题只剩模型 API 本身的服务条款")],
		},
		models: {
			text: "写几个适配器就接几个。参照：pi 的 provider 层 23,668 行，接了 40 家",
			evidence: [
				code("book", "book/01-choosing/ch02-what-is-pi.md", 239, 239, "23,668"),
				code("book", "research/BASELINE.md", 92, 92, "**40 个**"),
			],
		},
		process: {
			text: "进程内：循环就是你的一个函数",
			evidence: [code("book", "examples/ch01-anatomy/src/loop.ts", 109, 109, "export function runLoop")],
		},
		policy: {
			text: "没有。要人工审批、要日志、要按条件执行，官方文档让你改用手写循环",
			evidence: [doc(DOCS.toolRunner, "When you need human-in-the-loop approval, custom logging, or conditional execution, use the manual loop instead.")],
		},
		loop: {
			text: "全能改：循环本来就是你写的",
			evidence: [code("book", "examples/ch01-anatomy/src/loop.ts", 129, 129, "while (true)")],
		},
		upstream: {
			text: "没有上游，也就没有「回上游」这件事",
			evidence: [inference("自己写的代码没有上游仓库")],
		},
		cadence: {
			text: "只跟着模型 API 的变化走",
			evidence: [inference("唯一的外部依赖是模型 API 与（可选的）客户端 SDK")],
		},
	},
	ownership: [
		{
			text: "循环以外的一切：会话持久化、上下文压缩、工具、审批、沙箱、界面。pi 的产品层有 60,960 行，可以当作这张清单有多长的参照",
			evidence: [
				code("book", "research/BASELINE.md", 90, 90, "60,960"),
				code("book", "examples/ch01-anatomy/src/loop.ts", 109, 109, "runLoop"),
			],
		},
	],
};

const agentSdk: Route = {
	id: "agent-sdk",
	name: "Claude Agent SDK",
	summary: "把 Claude Code 当库用：SDK 起一个 claude 子进程，你拿到它的工具、权限、会话和钩子",
	facts: {
		runtime: {
			text: "Python 3.10+ 或 Node.js 18+；别的语言只能把 CLI 当子进程跑",
			evidence: [
				doc(DOCS.hosting, "Python 3.10+ for the Python SDK, or Node.js 18+ for the TypeScript SDK"),
				doc(DOCS.overview, "To drive the same agent loop from a language other than Python or TypeScript, run the CLI as a subprocess with the `-p` flag and `--output-format json`."),
			],
		},
		license: {
			text: "Anthropic 商业服务条款，不是开源许可；登录方式与品牌用法另有规定",
			evidence: [doc(DOCS.overview, "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service")],
		},
		models: {
			text: "Claude。文档明确不支持经网关把 Claude Code 路由到非 Claude 模型",
			evidence: [doc(DOCS.llmGateway, "doesn't support routing Claude Code to non-Claude models through any gateway")],
		},
		process: {
			text: "一个会话一个 claude 子进程，子进程持有 shell、工作目录和磁盘上的会话文件",
			evidence: [
				doc(DOCS.hosting, "The Agent SDK spawns and supervises a `claude` CLI subprocess that owns a shell, a working directory, and session files on disk."),
				doc(DOCS.hosting, "One agent session maps to one subprocess."),
			],
		},
		policy: {
			text: "权限模式现成；默认模式下没给回调就拒绝。沙箱只管 shell、默认关闭",
			evidence: [
				doc(DOCS.agentLoop, "no callback means deny"),
				doc(DOCS.sandboxing, "The sandbox covers shell commands only."),
				doc(DOCS.sandboxing, "The sandbox is off by default."),
			],
		},
		loop: {
			text: "改不了循环本身：它在 Claude Code 二进制里。能动的是选项和钩子，钩子跑在你的进程里",
			evidence: [
				doc(DOCS.overview, "A library that runs the Claude Code binary"),
				doc(DOCS.agentLoop, "Hooks run in your application process, not inside the agent's context window"),
			],
		},
		upstream: {
			text: "不适用：二进制跟着 SDK 版本走，升级 SDK 就是升级 CLI",
			evidence: [doc(DOCS.hosting, "The bundled binary is pinned to the SDK package version, so updating the SDK is how you update the CLI.")],
		},
		cadence: {
			text: "按 semver 发版：补丁版持续跟，小版本先读 changelog",
			evidence: [doc(DOCS.hosting, "The SDK follows semver: take patch releases continuously")],
		},
	},
	ownership: [
		{
			text: "不能给自己的用户提供 claude.ai 登录；产品不能叫「Claude Code」",
			evidence: [
				doc(DOCS.overview, "Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"),
				doc(DOCS.overview, "\"Claude Code\" or \"Claude Code Agent\""),
			],
		},
		{
			text: "每个会话一个子进程，起步按 1 GiB 内存算；会话自己不超时，长会话内存会涨，要你来回收",
			evidence: [
				doc(DOCS.hosting, "1 GiB RAM, 5 GiB disk, and 1 CPU per agent is a reasonable starting point"),
				doc(DOCS.hosting, "A session does not time out on its own."),
				doc(DOCS.hosting, "Memory growth over long sessions"),
			],
		},
	],
};

const TURN_RS = "codex-rs/core/src/session/turn.rs";
const PROVIDER_RS = "codex-rs/model-provider-info/src/lib.rs";

const forkCodex: Route = {
	id: "fork-codex",
	name: "fork codex",
	summary: "OpenAI 的 codex（Rust）整仓 fork 下来改",
	facts: {
		runtime: {
			text: "Rust 2024 edition，153 个 crate 的 workspace；TypeScript / Python SDK 都是包一层 CLI",
			evidence: [
				code("codex", "codex-rs/Cargo.toml", 165, 165, 'edition = "2024"'),
				measured("codex-rs/Cargo.toml 的 members 条目数", "153"),
				code("codex", "sdk/typescript/README.md", 5, 5, "spawns the CLI"),
			],
		},
		license: {
			text: "Apache-2.0：可以 fork、可以闭源分发，要保留 NOTICE、标明改动",
			evidence: [code("codex", "LICENSE", 1, 2, "Apache License"), code("codex", "LICENSE", 97, 98, "modified files")],
		},
		models: {
			text: "只说 Responses API，chat 线协议已删；内置的只有 OpenAI、Bedrock 和两个本地模型服务",
			evidence: [
				code("codex", PROVIDER_RS, 103, 107, "Responses,"),
				code("codex", PROVIDER_RS, 96, 96, "is no longer supported"),
				code("codex", PROVIDER_RS, 659, 662, "adjucating which third-party"),
			],
		},
		process: {
			text: "SDK 起 CLI 子进程、走 stdin/stdout 的 JSONL；宿主若是 Rust，可以直接链接 crate",
			evidence: [
				code("codex", "sdk/typescript/README.md", 5, 5, "exchanges JSONL events over stdin/stdout"),
				inference("codex-rs 是 Cargo workspace，Rust 宿主可以把 core crate 当依赖；本书没有实际这样集成过"),
			],
		},
		policy: {
			text: "内置：沙箱默认只读，审批默认由模型按需发起；macOS 用 seatbelt，Linux 用 bwrap",
			evidence: [
				code("codex", "codex-rs/protocol/src/config_types.rs", 104, 114, "ReadOnly"),
				code("codex", "codex-rs/protocol/src/protocol.rs", 986, 1007, "OnRequest"),
				code("codex", "codex-rs/core/src/sandboxing/mod.rs", 178, 178, "seatbelt"),
			],
		},
		loop: {
			text: "能改，但循环和产品长在一起：run_turn 所在的文件 3,167 行，里面就有找 .git、算权限档位",
			evidence: [
				code("codex", TURN_RS, 163, 163, "async fn run_turn("),
				code("codex", TURN_RS, 826, 839, '".git"'),
				code("codex", TURN_RS, 1252, 1252, "permission_profile"),
				measured(`wc -l ${TURN_RS}`, "3167"),
			],
		},
		upstream: {
			text: "回不去：上游不接受外部代码贡献",
			evidence: [code("codex", "docs/contributing.md", 5, 5, "We do not accept external code contributions or pull requests.")],
		},
		cadence: {
			text: "2026 年 4–9 月每月 879–1,448 个 commit",
			evidence: [measured("git log --format=%cd --date=format:%Y-%m | sort | uniq -c", "2026-04 1083 / 05 927 / 06 930 / 07 879 / 08 1262 / 09（到 28 日）1448")],
		},
	},
	ownership: [
		{
			text: "一个 1,023,821 行的 Rust workspace，所有改动都是本地补丁，每次跟上游都要自己 rebase",
			evidence: [
				measured(
					"BASELINE.md 的口径换成 .rs，再排除 *_tests.rs / tests.rs：git ls-files codex-rs | grep '\\.rs$' | grep -vE '(^|/)tests?/' | grep -v /examples/ | grep /src/ | grep -vE '(_tests?|/tests?)\\.rs$' | xargs wc -l",
					"2,998 个文件 / 1,023,821 行（文件内的 #[cfg(test)] 模块没法按文件排除，算在里面）",
				),
				code("codex", "docs/contributing.md", 5, 5, "We do not accept external code contributions"),
			],
		},
	],
};

const PI_README = "packages/coding-agent/README.md";

const pi: Route = {
	id: "pi",
	name: "基于 pi",
	summary: "把 pi 当 SDK 嵌进来，或者 fork 它的包；内核小、策略全留给你",
	facts: {
		runtime: {
			text: "TypeScript，Node ≥ 22.19；进程内嵌入只能是 Node 宿主，其他语言走 RPC 模式",
			evidence: [
				code("pi", "package.json", 63, 63, '"node": ">=22.19.0"'),
				code("pi", PI_README, 547, 547, "--mode rpc"),
			],
		},
		license: {
			text: "MIT：保留版权声明即可",
			evidence: [code("pi", "LICENSE", 1, 1, "MIT License")],
		},
		models: {
			text: "40 个 provider；不想要的可以整层换掉（Step-Code 把 23,668 行削到 12,178）",
			evidence: [
				code("book", "research/BASELINE.md", 92, 92, "**40 个**"),
				code("book", "book/01-choosing/ch02-what-is-pi.md", 239, 239, "**12,178**"),
			],
		},
		process: {
			text: "进程内：createAgentSession 返回一个会话对象；也可以 --mode rpc 当子进程",
			evidence: [
				code("pi", "packages/coding-agent/src/core/sdk.ts", 173, 173, "export async function createAgentSession("),
				code("pi", PI_README, 486, 486, "pi --mode rpc"),
			],
		},
		policy: {
			text: "没有：不弹审批、不带沙箱，都是明说的设计选择",
			evidence: [
				code("pi", PI_README, 503, 503, "No permission popups."),
				code("pi", "packages/coding-agent/docs/security.md", 33, 35, "Pi does not include a built-in sandbox."),
			],
		},
		loop: {
			text: "能改，而且小：内核 794 行，不认识文件、bash、git；本书看过的下游里，改它的只有 Step-Code 的 +39 行和 minimax-code 加的几个钩子",
			evidence: [
				code("book", "research/BASELINE.md", 89, 89, "794 行"),
				measured("grep -ciE 'bash|file|edit|git|cwd' packages/agent/src/agent-loop.ts", "0"),
				code("book", "book/01-choosing/ch02-what-is-pi.md", 239, 240, "+39"),
				code("book", "book/01-choosing/ch02-what-is-pi.md", 240, 240, "加了几个钩子"),
			],
		},
		upstream: {
			text: "开放，但新贡献者的 issue / PR 默认自动关闭，维护者每天复看",
			evidence: [code("pi", "README.md", 11, 11, "auto-closed by default")],
		},
		cadence: {
			text: "2026 年 3–8 月每月 419–527 个 commit",
			evidence: [measured("git log --format=%cd --date=format:%Y-%m | sort | uniq -c", "2026-03 419 / 04 460 / 05 482 / 06 421 / 07 497 / 08 527")],
		},
	},
	ownership: [
		{
			text: "七样「决定不做」的东西要你自己补或者明确不要：MCP、子 agent、审批弹窗、计划模式、待办、后台 bash，以及沙箱",
			evidence: [
				code("pi", PI_README, 499, 509, "No MCP."),
				code("book", "book/01-choosing/ch04-capability-boundary.md", 26, 26, "决定不做"),
			],
		},
		{
			text: "改了的东西多半要自己留着：minimax-code 的补丁台账 38 条，35 条写明没开上游 PR",
			evidence: [code("book", "book/04-shipping/ch24-upstream-strategy.md", 364, 364, "台账 38 条，35 条写明没开上游 PR")],
		},
	],
};

const ALL: Readonly<Record<RouteId, Route>> = {
	"direct-api": directApi,
	"agent-sdk": agentSdk,
	"fork-codex": forkCodex,
	pi,
};

export function routeOf(id: RouteId): Route {
	return ALL[id];
}

export const ROUTES: readonly Route[] = [directApi, agentSdk, forkCodex, pi];
