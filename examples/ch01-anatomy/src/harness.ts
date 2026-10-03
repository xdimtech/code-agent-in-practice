/**
 * 第 1 章的第二个实现：给裸循环套一层 harness。
 *
 * `loop.ts` 只做「说话 → 跑工具 → 再说话」。它不知道：
 *   - 这次要给模型看哪些工具（`tools.ts` 里有三个，不代表每次都该给三个）
 *   - 系统提示词从哪来
 *   - 一次会话的历史存不存、存哪
 *   - 上下文快撑爆了怎么办
 *   - 用户中途改主意了怎么办
 *
 * 这些都不是循环的事，但也都不是「产品界面」的事——它是**接线**。
 * 这层接线在 pi 里有名字：`packages/agent/src/harness/`，10,065 行。
 * 本节这 150 行当然不是它，但它展示的是同一个东西：**把循环接到具体场景上**。
 *
 * 每个函数头部都标了它在 pi 里对应的位置。你按那个路径去看原版，
 * 会发现实现细节不一样，但「这件事归 harness 管」是一致的。
 */

import { runLoop } from "./loop.ts";
import type { LoopResult, ModelFn, RunLoopOptions } from "./loop.ts";
import type { Context, Message, Tool } from "./types.ts";

// ── 1. 工具集：不是「有哪些工具」，而是「这一次给哪些」 ──────────────────

export interface ToolSelection {
	readonly active: readonly Tool[];
	/** 没给模型的工具，为什么没给。这句话要能被打印出来。 */
	readonly excluded: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * 从全部工具里挑出这一次要给的。
 *
 * pi 的对应物是 `activeToolNames`：默认为 read / bash / edit / write 四个
 * （`coding-agent/src/core/agent-session.ts:2801-2803`），
 * 另有一份只读集合 read / grep / find / ls（`core/tools/index.ts:173-179`）——
 * 同一批实现，两种用法。**「有哪些工具」和「这次给哪些」是两个问题**，
 * 混在一起写，就没法在不改实现的前提下只给一部分。
 */
export function selectTools(
	all: readonly Tool[],
	options: { readonly readOnly?: boolean; readonly exclude?: readonly string[] } = {},
): ToolSelection {
	const active: Tool[] = [];
	const excluded: { name: string; reason: string }[] = [];
	for (const tool of all) {
		if (options.exclude?.includes(tool.spec.name)) {
			excluded.push({ name: tool.spec.name, reason: "被 exclude 名单排除" });
			continue;
		}
		if (options.readOnly && tool.spec.name === "write_file") {
			excluded.push({ name: tool.spec.name, reason: "本次是只读模式" });
			continue;
		}
		active.push(tool);
	}
	return { active, excluded };
}

// ── 2. 系统提示词：循环不管它从哪来 ─────────────────────────────────────

export interface PromptParts {
	/** 面向所有人的基座。 */
	readonly base: string;
	/** 当前目录下发现的项目说明（pi 找的是 AGENTS.md / CLAUDE.md）。 */
	readonly projectContext?: readonly { readonly path: string; readonly content: string }[];
	/** 扩展追加的一段。pi 的对应物是 `appendSystemPrompt`。 */
	readonly appended?: string;
}

/**
 * 拼系统提示词。
 *
 * pi 的对应物是 `buildSystemPrompt`（`core/system-prompt.ts:28`），
 * 它接受的正是这几样：`customPrompt`、`contextFiles`、`appendSystemPrompt`、
 * `skills`、`cwd`。项目文件被包成 `<project_instructions path="…">` 塞进去
 * （`system-prompt.ts:52-58`）。
 *
 * 注意上下文文件是**拼进提示词**、不是当成消息发出去的：它属于
 * 「每次请求都一样的那部分」，而消息是「一直在变的那部分」。
 * 这个区分决定了前缀缓存能不能命中（第 12 章）。
 */
export function buildPrompt(parts: PromptParts): string {
	let prompt = parts.base;
	if (parts.projectContext && parts.projectContext.length > 0) {
		prompt += "\n\n<project_context>\n\n项目说明：\n\n";
		for (const file of parts.projectContext) {
			prompt += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}
	if (parts.appended) prompt += `\n\n${parts.appended}`;
	return prompt;
}

/** 工具的说明书怎么进提示词：只要名字和一句话，不要整个 schema。 */
export function toolSnippets(tools: readonly Tool[]): string {
	return tools.map((tool) => `- ${tool.spec.name}: ${tool.spec.description}`).join("\n");
}

// ── 3. 会话：历史存哪 ───────────────────────────────────────────────────

export interface SessionStore {
	/** 只追加。追加失败要抛出——静默丢历史比报错严重。 */
	append(record: SessionRecord): void;
	readonly records: readonly SessionRecord[];
}

export type SessionRecord =
	| { readonly kind: "session"; readonly cwd: string; readonly startedAt: string }
	| { readonly kind: "message"; readonly message: Message }
	| { readonly kind: "stop"; readonly stopKind: string; readonly turns: number };

/** 内存实现。pi 把它落到磁盘上的 `.jsonl`，一行一条记录（第 14 章）。 */
export function memorySessionStore(cwd: string, now: () => string): SessionStore {
	const records: SessionRecord[] = [];
	let opened = false;
	return {
		append(record) {
			if (!opened) {
				if (record.kind !== "session") throw new Error("会话的第一条记录必须是 session");
				opened = true;
			}
			records.push(record);
		},
		get records() {
			return records;
		},
	};
}

/** 从历史里重建上下文。这就是「恢复会话」的全部内容。 */
export function resumeContext(store: SessionStore, systemPrompt: string, tools: readonly Tool[]): Context {
	return {
		systemPrompt,
		tools: tools.map((tool) => tool.spec),
		messages: store.records
			.filter((r): r is Extract<SessionRecord, { kind: "message" }> => r.kind === "message")
			.map((r) => r.message),
	};
}

// ── 4. 组装：把上面几件接进循环 ─────────────────────────────────────────

export interface HarnessOptions {
	readonly cwd: string;
	readonly model: ModelFn;
	readonly allTools: readonly Tool[];
	readonly prompt: PromptParts;
	readonly session: SessionStore;
	readonly now: () => string;
	/**
	 * 用户这次说的话。真实场景里它来自命令行或输入框，
	 * 但**它必须在循环开始之前就进上下文**——模型需要有东西可回应。
	 * 循环自己不造这条消息：它不知道用户是谁，也不知道用户说了什么。
	 */
	readonly userMessage: string;
	/** 只读模式：写工具被摘掉。 */
	readonly readOnly?: boolean;
	/** 场景：给循环上的保险（轮数上限）。 */
	readonly maxTurns?: number;
	readonly shouldStopAfterTurn?: RunLoopOptions["shouldStopAfterTurn"];
}

export interface HarnessRun {
	readonly result: LoopResult;
	readonly context: Context;
	readonly selection: ToolSelection;
	readonly systemPrompt: string;
}

/**
 * 这个函数就是 harness 的骨架：**准备 → 跑 → 记录**。
 * 三件事排在一起，正好说明循环为什么可以那么小——
 * 准备工作全在外面做完了，循环拿到的是一个拼好的 `Context`。
 */
export function runWithHarness(options: HarnessOptions): HarnessRun {
	const selection = selectTools(options.allTools, { readOnly: options.readOnly });

	const base = options.prompt.base + "\n\n可用工具：\n" + toolSnippets(selection.active);
	const systemPrompt = buildPrompt({
		...options.prompt,
		base,
	});

	// 用户消息作为 prompts 交给循环，而不是由 harness 自己塞进上下文：
	// 这样它和其它消息一样会发 message_end，会话记录只订阅一个事件就够。
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: options.userMessage }],
	};

	const context: Context = {
		systemPrompt,
		tools: selection.active.map((tool) => tool.spec),
		messages: [],
	};

	options.session.append({
		kind: "session",
		cwd: options.cwd,
		startedAt: options.now(),
	});

	const result = runLoop({
		model: options.model,
		tools: selection.active,
		context,
		prompts: [userMessage],
		maxTurns: options.maxTurns,
		shouldStopAfterTurn: options.shouldStopAfterTurn,
		// 会话记录跟着事件走，而不是跟着循环的内部状态走。
		// 能只订阅 message_end，靠的是循环那条不变式：这次进上下文的消息
		// ——用户、助手、工具结果——每条都发一次（`agent/src/types.ts:436`）。
		// 少了任何一种，重放出来的历史就缺一块，而且不会报错（1.4 节）。
		emit: (event) => {
			if (event.type === "message_end") {
				options.session.append({ kind: "message", message: event.message });
			}
		},
	});

	options.session.append({ kind: "stop", stopKind: result.stopKind, turns: result.turns });

	return {
		result,
		context: {
			...context,
			messages: result.messages,
		},
		selection,
		systemPrompt,
	};
}

/** 这一章把上下文摊开给人看，靠的是这个。 */
export function describeContext(context: Context): string {
	const lines = [
		`systemPrompt：${context.systemPrompt.length} 字符`,
		`tools：${context.tools.map((t) => t.name).join(", ") || "（无）"}`,
		`messages：${context.messages.length} 条`,
	];
	for (const message of context.messages) {
		const kinds = message.content.map((block) => block.type).join("+");
		lines.push(`  ${message.role} (${kinds})`);
	}
	return lines.join("\n");
}
