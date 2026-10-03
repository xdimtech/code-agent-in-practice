import type { EventName } from "./types.ts";

// 把一个扩展事件压成一行 trace：只留看顺序要用的字段，不留内容。
// 不写进 trace 的：消息正文、工具参数和结果、用户输入、! 命令、system prompt、请求体、HTTP 头——这些都可能带密钥。

export type TraceRecord = Readonly<Record<string, string | number | boolean>>;

type Rec = Readonly<Record<string, unknown>>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** 每个事件允许留下的标量字段；值不是 string / number / boolean 的一律丢掉 */
const SAFE_FIELDS: Readonly<Partial<Record<EventName, readonly string[]>>> = {
  session_start: ["reason"],
  session_shutdown: ["reason"],
  resources_discover: ["reason"],
  session_before_switch: ["reason"],
  session_before_fork: ["position"],
  input: ["source", "streamingBehavior"],
  user_bash: ["excludeFromContext"],
  turn_start: ["turnIndex"],
  turn_end: ["turnIndex"],
  tool_execution_start: ["toolCallId", "toolName"],
  tool_execution_update: ["toolCallId", "toolName"],
  tool_execution_end: ["toolCallId", "toolName", "isError"],
  tool_call: ["toolCallId", "toolName"],
  tool_result: ["toolCallId", "toolName", "isError"],
  after_provider_response: ["status"],
  model_select: ["source"],
  thinking_level_select: ["level", "previousLevel"],
  ui_prompt_start: ["kind"],
  ui_prompt_end: ["kind"],
};

/** 消息类事件额外留 role 和 stopReason（stopReason 只有助手消息有） */
const MESSAGE_EVENTS: ReadonlySet<string> = new Set(["message_start", "message_update", "message_end"]);

const scalar = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export function toRecord(type: EventName, event: unknown, seq: number): TraceRecord {
  const out: Record<string, string | number | boolean> = { seq, type };
  if (!isRec(event)) return out;
  for (const k of SAFE_FIELDS[type] ?? []) {
    const v = event[k];
    if (scalar(v)) out[k] = v;
  }
  if (MESSAGE_EVENTS.has(type) && isRec(event.message)) {
    if (typeof event.message.role === "string") out.role = event.message.role;
    if (typeof event.message.stopReason === "string") out.stopReason = event.message.stopReason;
  }
  return out;
}

/**
 * message_update 每个 token 发一次，tool_execution_update 每段输出发一次；都照录 trace 会大到没法读。
 * 同一条消息、同一次工具调用只录第一条。返回新的「已见过」集合，不改传进来的那个。
 */
export function shouldRecord(type: EventName, event: unknown, seen: ReadonlySet<string>): { record: boolean; seen: ReadonlySet<string> } {
  const key = type === "message_update" ? "message" : type === "tool_execution_update" && isRec(event) ? `tool:${String(event.toolCallId)}` : undefined;
  if (type === "message_start") return { record: true, seen: new Set([...seen].filter((k) => k !== "message")) };
  if (key === undefined) return { record: true, seen };
  if (seen.has(key)) return { record: false, seen };
  return { record: true, seen: new Set([...seen, key]) };
}
