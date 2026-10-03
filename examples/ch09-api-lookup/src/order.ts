import { isEventName } from "./catalog.ts";
import type { Finding } from "./types.ts";

// 检查一份事件 trace（extension/trace.ts 写的 JSONL，每行至少有 type）是否符合 pi 的触发顺序。
// 顺序是照代码核对过的，不是照 docs/extensions.md 的生命周期图（那张图把用户消息画在 turn_start 之前，
// 代码里是 agent_start → turn_start → 用户消息的 message_start / message_end，agent/agent-loop.ts:110-115）。

export interface TraceEvent {
  /** trace 里第几行，从 1 开始 */
  readonly line: number;
  readonly type: string;
  readonly toolCallId?: string;
}

export interface OrderReport {
  readonly events: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 解析 JSONL；坏行变成发现，不中断 */
export function parseTrace(text: string): { events: readonly TraceEvent[]; findings: readonly Finding[] } {
  const events: TraceEvent[] = [];
  const findings: Finding[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === "") return;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      findings.push({ severity: "error", rule: "not-json", line, message: "这一行不是 JSON" });
      return;
    }
    if (!isRecord(v) || typeof v.type !== "string") {
      findings.push({ severity: "error", rule: "no-type", line, message: "这一行没有字符串类型的 type 字段" });
      return;
    }
    events.push(typeof v.toolCallId === "string" ? { line, type: v.type, toolCallId: v.toolCallId } : { line, type: v.type });
  });
  return { events, findings };
}

/** 不是 36 个扩展事件之一：可能是 --mode json 才有的事件（auto_retry_start、queue_update……）或者拼错了 */
function unknownEvents(events: readonly TraceEvent[]): Finding[] {
  return events.filter((e) => !isEventName(e.type)).map((e) => ({ severity: "warn", rule: "unknown-event", line: e.line, message: `${e.type} 不是扩展能订阅的事件，忽略` }));
}

type ToolStage = "started" | "called" | "resulted" | "ended";

/**
 * 每个 toolCallId：tool_execution_start → tool_call → (tool_execution_update) → tool_result → tool_execution_end。
 * agent-loop.ts:443-470（顺序执行）、:498-530（并行执行）；prepareToolCall :614-665；finalizeExecutedToolCall :711-756。
 */
function toolOrder(events: readonly TraceEvent[]): Finding[] {
  const hasToolCall = events.some((e) => e.type === "tool_call");
  const stage = new Map<string, ToolStage>();
  const out: Finding[] = [];
  const err = (e: TraceEvent, rule: string, message: string) => out.push({ severity: "error", rule, line: e.line, message });
  for (const e of events) {
    const id = e.toolCallId;
    if (id === undefined || !e.type.startsWith("tool_")) continue;
    const now = stage.get(id);
    if (e.type === "tool_execution_start") {
      // tool_call 抢在前面的情况上面已经报过，这里不再算一次重复的 start
      if (now === "called") continue;
      if (now !== undefined) err(e, "tool-restarted", `${id} 第二次 tool_execution_start`);
      stage.set(id, "started");
    } else if (e.type === "tool_call") {
      if (now !== "started") err(e, "call-before-start", `${id} 的 tool_call 前面没有 tool_execution_start（宿主先发 start 再调 tool_call）`);
      stage.set(id, "called");
    } else if (e.type === "tool_execution_update") {
      if (now === undefined || now === "ended") err(e, "update-outside", `${id} 的 tool_execution_update 不在 start 和 end 之间`);
    } else if (e.type === "tool_result") {
      if (hasToolCall && now !== "called") err(e, "result-without-call", `${id} 的 tool_result 前面没有 tool_call`);
      stage.set(id, "resulted");
    } else if (e.type === "tool_execution_end") {
      out.push(...endFinding(e, id, now, hasToolCall));
      stage.set(id, "ended");
    }
  }
  for (const [id, s] of stage) if (s !== "ended") out.push({ severity: "warn", rule: "tool-unfinished", message: `${id} 没有 tool_execution_end（trace 被截断，或进程中途退出）` });
  return out;
}

function endFinding(e: TraceEvent, id: string, now: ToolStage | undefined, hasToolCall: boolean): Finding[] {
  if (now === undefined || now === "ended") return [{ severity: "error", rule: "end-without-start", line: e.line, message: `${id} 的 tool_execution_end 前面没有对应的 start` }];
  if (!hasToolCall) return [];
  if (now === "started") return [{ severity: "info", rule: "not-prepared", line: e.line, message: `${id} 没走到 tool_call：参数校验失败、工具不存在，或消息因输出上限被截断（agent-loop.ts:379-400、:614-665）` }];
  if (now === "called") return [{ severity: "info", rule: "blocked", line: e.line, message: `${id} 有 tool_call 没有 tool_result：被拦下了（block、处理函数抛错，或中途 abort）` }];
  return [];
}

/** 嵌套：agent_start ⊃ turn_start ⊃ message_start ⊃ message_update；agent_settled 收尾 */
function nesting(events: readonly TraceEvent[]): Finding[] {
  const out: Finding[] = [];
  let inAgent = false;
  let inTurn = false;
  let inMessage = false;
  let endedSinceSettle = 0;
  for (const e of events) {
    const f = (severity: Finding["severity"], rule: string, message: string) => out.push({ severity, rule, line: e.line, message });
    switch (e.type) {
      case "agent_start":
        if (inAgent) f("error", "agent-reentered", "上一个 agent_start 还没有 agent_end");
        inAgent = true;
        break;
      case "agent_end":
        if (!inAgent) f("error", "agent-end-without-start", "agent_end 前面没有 agent_start");
        if (inTurn) f("error", "turn-open-at-agent-end", "agent_end 时还有一轮没结束（宿主总是先发 turn_end）");
        inAgent = inTurn = false;
        endedSinceSettle++;
        break;
      case "turn_start":
        if (!inAgent) f("error", "turn-outside-agent", "turn_start 不在 agent_start 和 agent_end 之间");
        if (inTurn) f("error", "turn-reentered", "上一轮还没有 turn_end");
        inTurn = true;
        break;
      case "turn_end":
        // 运行在 turn_end 之后才抛错时，agent.ts:525 会再补一个 turn_end，所以这里只是提醒
        if (!inTurn) f("warn", "turn-end-without-start", "turn_end 前面没有对应的 turn_start（可能是运行失败时宿主补发的，agent.ts:511-527）");
        inTurn = false;
        break;
      case "message_start":
        if (inMessage) f("error", "message-reentered", "上一条消息还没有 message_end");
        // 扩展看到的消息事件都来自 agent 循环，循环先发 turn_start 再发用户消息（agent-loop.ts:110-115）；
        // docs/extensions.md 的生命周期图把用户消息画在 turn_start 之前，照图写的 trace 会在这里报出来
        if (!inTurn) f("warn", "message-outside-turn", "message_start 不在一轮之内");
        inMessage = true;
        break;
      case "message_update":
        if (!inMessage) f("error", "update-outside-message", "message_update 不在 message_start 和 message_end 之间");
        break;
      case "message_end":
        if (!inMessage) f("error", "message-end-without-start", "message_end 前面没有 message_start");
        inMessage = false;
        break;
      case "agent_settled":
        if (inAgent) f("error", "settled-while-running", "agent_settled 时 agent 还没 agent_end");
        else if (endedSinceSettle === 0) f("error", "settled-without-end", "agent_settled 前面没有 agent_end");
        else if (endedSinceSettle > 1) f("info", "settled-after-continue", `这次 settled 之前有 ${endedSinceSettle} 对 agent_start / agent_end：自动重试、自动压缩或 agent_end 里排的消息让它又跑了（agent-session.ts:1106-1149）`);
        endedSinceSettle = 0;
        break;
    }
  }
  if (inAgent) out.push({ severity: "warn", rule: "agent-unfinished", message: "trace 结束时 agent 还没 agent_end" });
  return out;
}

/** 一轮里第一次发请求之前必须先有 context（agent-loop.ts:288-289 在 streamFunction 之前跑 transformContext） */
function requestOrder(events: readonly TraceEvent[]): Finding[] {
  const out: Finding[] = [];
  let inTurn = false;
  let sawContext = false;
  for (const e of events) {
    if (e.type === "turn_start") {
      inTurn = true;
      sawContext = false;
    } else if (e.type === "turn_end") inTurn = false;
    else if (e.type === "context") sawContext = true;
    else if (inTurn && !sawContext && (e.type === "before_provider_headers" || e.type === "before_provider_request")) {
      out.push({ severity: "error", rule: "request-before-context", line: e.line, message: `${e.type} 出现在这一轮的 context 之前` });
    }
  }
  return out;
}

export function checkOrder(text: string): OrderReport {
  const parsed = parseTrace(text);
  const events = parsed.events;
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const known = events.filter((e) => isEventName(e.type));
  const findings = [...parsed.findings, ...unknownEvents(events), ...toolOrder(known), ...nesting(known), ...requestOrder(known)];
  const ordered = [...findings].sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
  return { events: events.length, counts, findings: ordered };
}

export const hasErrors = (r: OrderReport): boolean => r.findings.some((f) => f.severity === "error");
