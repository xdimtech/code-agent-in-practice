/**
 * 把一个 `--mode json` 的输出流，读成一条人读的时间线。
 *
 * 为什么需要它：`--mode json` 是 NDJSON，一行一个事件（modes/print-mode.ts:109-110
 * 对每个事件写一行 `JSON.stringify(toJsonEvent(event))`）。一跑就是二十几行，
 * 直接看原始 JSON 看不出哪些行属于同一轮、哪些行是同一件事的不同阶段。
 *
 * 这里只做两件事：按轮分组，然后把每行压成一句话。压的时候丢掉内容只留
 * 形状（长度、块数、工具名），因为这一章要看的是"发生了什么"，
 * 不是"说了什么"。
 */

export interface TimelineEvent {
	readonly type: string;
	readonly raw: Record<string, unknown>;
}

export interface TimelineTurn {
	/** 从 1 开始。0 用来放轮次之外的事件（agent_start 之类）。 */
	readonly turn: number;
	readonly events: readonly TimelineEvent[];
}

export interface Timeline {
	/** 第一行的 session 头，`--mode json` 会先写它（modes/print-mode.ts:122-125）。 */
	readonly header: Record<string, unknown> | undefined;
	readonly turns: readonly TimelineTurn[];
	readonly total: number;
}

/**
 * 解析 NDJSON 文本。
 *
 * 坏行不抛错：真实运行里 stdout 可能混进别的输出，为了读懂一整条时间线
 * 而在一行上报废全部，不划算。坏行留在 raw 里（`_parseError`），便于回头看。
 */
export function parseNdjson(text: string): readonly TimelineEvent[] {
	const events: TimelineEvent[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				const raw = parsed as Record<string, unknown>;
				events.push({ type: asString(raw.type) ?? "（没有 type）", raw });
				continue;
			}
			events.push({ type: "（不是对象）", raw: { _parseError: line } });
		} catch {
			events.push({ type: "（不是 JSON）", raw: { _parseError: line } });
		}
	}
	return events;
}

/**
 * 按轮分组。`turn_start` 开一轮，`turn_end` 收一轮；两侧的事件挂在轮 0。
 *
 * 这不是 pi 的概念，是为了读起来方便加的。pi 自己不分组 —— 它就是一行一行发。
 */
export function groupByTurn(events: readonly TimelineEvent[]): Timeline {
	let turn = 0;
	let inTurn = false;
	const turns: TimelineTurn[] = [];
	let bucket: TimelineEvent[] = [];
	let header: Record<string, unknown> | undefined;

	const flush = () => {
		if (bucket.length > 0) turns.push({ turn: inTurn ? turn : 0, events: bucket });
		bucket = [];
	};

	for (const event of events) {
		if (event.type === "session" && header === undefined) {
			header = event.raw;
			flush();
			bucket.push(event);
			continue;
		}
		if (event.type === "turn_start") {
			flush();
			turn += 1;
			inTurn = true;
			bucket.push(event);
			continue;
		}
		if (event.type === "turn_end") {
			bucket.push(event);
			flush();
			inTurn = false;
			continue;
		}
		if (!inTurn && bucket.length > 0 && turns.length === 0 && bucket.some((e) => e.type === "session")) {
			flush();
		}
		bucket.push(event);
	}
	flush();
	return { header, turns, total: events.length };
}

/** 一行一句话。字段名照着 pi 的，长度和块数是这里加的可读性信息。 */
export function describeEvent(event: TimelineEvent): string {
	const raw = event.raw;
	const content = raw.message !== null && typeof raw.message === "object" ? (raw.message as Record<string, unknown>) : undefined;
	const blocks = Array.isArray(content?.content) ? (content?.content as unknown[]) : undefined;
	const shape = blocks === undefined ? "" : ` ${blocks.length} 块`;

	switch (event.type) {
		case "session":
			return `会话头：version ${JSON.stringify(raw.version)}，id ${short(raw.id)}`;
		case "agent_start":
			return "一次运行开始";
		case "agent_end":
			return "一次运行结束";
		case "agent_settled":
			return "没有待处理的消息了，pi 准备退出";
		case "turn_start":
			return "—— 新一轮 ——";
		case "turn_end":
			return "—— 本轮结束 ——";
		case "message_start":
			return `一条消息开始：${roleOf(raw)}${shape}`;
		case "message_end":
			return `一条消息结束：${roleOf(raw)}${shape}${stopReasonSuffix(raw)}`;
		case "message_update":
			return `增量更新：${updateKind(raw)}`;
		case "tool_execution_start":
			return `开始执行工具 ${JSON.stringify(raw.toolName ?? "?")}`;
		case "tool_execution_end":
			return `工具 ${JSON.stringify(raw.toolName ?? "?")} 执行完${raw.isError === true ? "（出错）" : ""}`;
		default:
			return event.type;
	}
}

function stopReasonSuffix(raw: Record<string, unknown>): string {
	const message = raw.message !== null && typeof raw.message === "object" ? (raw.message as Record<string, unknown>) : undefined;
	const reason = message?.stopReason;
	return typeof reason === "string" ? `，stopReason=${reason}` : "";
}

function roleOf(raw: Record<string, unknown>): string {
	const message = raw.message !== null && typeof raw.message === "object" ? (raw.message as Record<string, unknown>) : undefined;
	return asString(message?.role) ?? asString(raw.role) ?? "?";
}

/**
 * 增量的种类。pi 把它放在 `assistantMessageEvent` 里（这一层是 json-event 转换
 * 加的，原始事件里没有），不是 `delta`。
 */
function updateKind(raw: Record<string, unknown>): string {
	const inner =
		raw.assistantMessageEvent !== null && typeof raw.assistantMessageEvent === "object"
			? (raw.assistantMessageEvent as Record<string, unknown>)
			: raw.delta !== null && typeof raw.delta === "object"
				? (raw.delta as Record<string, unknown>)
				: undefined;
	const type = asString(inner?.type);
	if (type === "text_delta") return `文本 +${(asString(inner?.delta) ?? "").length} 字符`;
	if (type === "toolcall_start" || type === "toolcall_end") {
		const call = inner?.toolCall !== null && typeof inner?.toolCall === "object" ? (inner?.toolCall as Record<string, unknown>) : undefined;
		const name = asString(inner?.toolName) ?? asString(call?.name) ?? "?";
		const args = call?.arguments === undefined ? "" : `(${JSON.stringify(call.arguments)})`;
		return `${type}：${name}${args}`;
	}
	if (type !== undefined) return type;
	return asString(raw.streamEvent) ?? asString(raw.event) ?? "（未知）";
}

function short(value: unknown): string {
	const text = asString(value) ?? "?";
	return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

/** 整条时间线，人读。 */
export function renderTimeline(timeline: Timeline): string {
	const lines: string[] = [];
	if (timeline.header) {
		lines.push(`会话头：${JSON.stringify(timeline.header.id ?? "?")}，version ${JSON.stringify(timeline.header.version)}`);
	}
	for (const group of timeline.turns) {
		lines.push(group.turn === 0 ? "[轮次之外]" : `[第 ${group.turn} 轮]`);
		for (const event of group.events) lines.push(`  ${describeEvent(event)}`);
	}
	lines.push("");
	lines.push(`共 ${timeline.total} 个事件，${timeline.turns.filter((t) => t.turn > 0).length} 轮。`);
	return lines.join("\n");
}

/** 每个事件类型出现几次。用来和 pi 的事件表对账。 */
export function countByType(events: readonly TimelineEvent[]): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
	return counts;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
