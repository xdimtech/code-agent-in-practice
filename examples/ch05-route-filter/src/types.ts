/**
 * 共用类型。
 *
 * 整个例子只有一个想法：把「选哪条路」拆成两样东西——
 *
 *   事实（routes.ts）     每条路线是什么样，每一条都带出处
 *   硬约束（questions.ts）你的项目有哪些不能让步的条件，每个条件对每条路线要么排除、要么加一项义务
 *
 * 然后用一个纯函数把它们对起来（filter.ts）。没有打分，没有权重，也不排名次：
 * 一条路线要么被某个硬约束排除了（附理由和出处），要么留下来，带着一张「选它你要自己扛的事」的清单。
 */

/** 本章对照的四条路线 */
export type RouteId = "direct-api" | "agent-sdk" | "fork-codex" | "pi";

export const ROUTE_IDS: readonly RouteId[] = ["direct-api", "agent-sdk", "fork-codex", "pi"];

/**
 * 出处的四种写法，对应正文的证据标签：
 *
 *   code      【代码事实】某个仓库里的某几行。needle 是这几行里必须出现的一段原文，verify 会去核对；
 *             repo 是 pi / codex（按 BASELINE.md 锁定的 commit）或 book（本书仓库自己）
 *   doc       【文档】公开文档的一句原话。Claude Agent SDK 只用这一种：本书不读它的源码
 *   measured  【实机】一条命令量出来的数
 *   inference 【推断】从上面几种推出来的，没有直接证据，basis 写推的依据
 */
export type Evidence =
	| { readonly kind: "code"; readonly repo: Repo; readonly path: string; readonly lines: readonly [number, number]; readonly needle: string }
	| { readonly kind: "doc"; readonly url: string; readonly quote: string }
	| { readonly kind: "measured"; readonly command: string; readonly value: string }
	| { readonly kind: "inference"; readonly basis: string };

export type Repo = "pi" | "codex" | "book";

export type CodeEvidence = Extract<Evidence, { kind: "code" }>;
export type DocEvidence = Extract<Evidence, { kind: "doc" }>;

/** 一条带出处的陈述 */
export interface Fact {
	readonly text: string;
	readonly evidence: readonly Evidence[];
}

/** 对照表的几个维度。顺序就是打印顺序 */
export type Dimension = "runtime" | "license" | "models" | "process" | "policy" | "loop" | "upstream" | "cadence";

export const DIMENSIONS: readonly { readonly id: Dimension; readonly label: string }[] = [
	{ id: "runtime", label: "语言与运行时" },
	{ id: "license", label: "许可与条款" },
	{ id: "models", label: "能接的模型" },
	{ id: "process", label: "进程模型" },
	{ id: "policy", label: "内置策略" },
	{ id: "loop", label: "循环能不能改" },
	{ id: "upstream", label: "改动能不能回上游" },
	{ id: "cadence", label: "上游节奏" },
];

export interface Route {
	readonly id: RouteId;
	readonly name: string;
	/** 一句话：这条路线是什么 */
	readonly summary: string;
	readonly facts: Readonly<Record<Dimension, Fact>>;
	/** 不管你回答什么，选了它都要自己扛的事 */
	readonly ownership: readonly Fact[];
}

/** 一个硬约束问题。选项是封闭的：命令行传进来的值要先对得上这里 */
export interface Question {
	readonly id: QuestionId;
	readonly prompt: string;
	readonly options: Readonly<Record<string, string>>;
}

export type QuestionId = "models" | "host" | "session-process" | "approval" | "sandbox" | "loop" | "upstream" | "license";

export type Answers = Readonly<Partial<Record<QuestionId, string>>>;

/**
 * 一条规则：当回答满足 when 里的每一项时，对 route 产生 effect。
 *
 * when 是「且」：`{ host: ["python"], "session-process": ["no"] }` 表示宿主是 Python **而且**
 * 不能每会话起一个进程。没回答的问题不匹配任何规则——没问到的条件不该悄悄排除一条路线。
 */
export interface Rule {
	readonly route: RouteId;
	readonly when: Readonly<Partial<Record<QuestionId, readonly string[]>>>;
	readonly effect: "exclude" | "obligation";
	readonly reason: string;
	readonly evidence: readonly Evidence[];
}

/** 一条规则命中之后，带着是哪个问题触发的 */
export interface Finding {
	readonly questions: readonly QuestionId[];
	readonly reason: string;
	readonly evidence: readonly Evidence[];
}

export interface Verdict {
	readonly route: Route;
	readonly status: "viable" | "excluded";
	readonly exclusions: readonly Finding[];
	/** 本次回答新增的义务，加上路线自带的 ownership */
	readonly obligations: readonly Finding[];
}
