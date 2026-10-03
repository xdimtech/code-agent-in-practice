// 一个最小的工具宿主：照 pi agent/src/agent-loop.ts:409-789 把一批工具调用跑完。每一步在 pi 里的位置：
//   - 批次模式：任何一个工具声明 sequential，整批串行（:416-423）
//   - 准备：找工具 → prepareArguments → 校验 → beforeToolCall（:598-666）；任何一步出错都直接变成错误结果，不执行
//   - 执行：抛错 → isError true；返回值 → isError false，返回值里没有 isError 这个字段（:668-709）
//   - onUpdate：工具结束后再调就被忽略（:681-682、:696）
//   - afterToolCall：逐字段覆盖，没给的字段保留；它自己抛错也变成错误结果（:711-756）
//   - 并行时：准备按顺序一个个做，执行一起跑，结果消息按原顺序发（:497-546）
//   - 整批 terminate 只在每个结果都要求 terminate 时成立（:580-582）

import { validateArguments } from "./validate.ts";
import type { ExecutionMode, TextContent, ToolCall, ToolContext, ToolDef, ToolResult, ToolResultMessage } from "./types.ts";
import { text } from "./types.ts";

export interface BlockDecision {
  readonly block: boolean;
  readonly reason?: string;
  readonly terminate?: boolean;
}

export interface AfterPatch {
  readonly content?: readonly TextContent[];
  readonly details?: unknown;
  readonly terminate?: boolean;
  readonly isError?: boolean;
}

export interface Hooks {
  /** 对应扩展的 tool_call 事件；返回 { block: true } 就拦下 */
  readonly beforeToolCall?: (call: ToolCall, args: unknown) => Promise<BlockDecision | undefined> | BlockDecision | undefined;
  /** 对应扩展的 tool_result 事件；返回的字段逐个覆盖 */
  readonly afterToolCall?: (call: ToolCall, args: unknown, result: ToolResult, isError: boolean) => Promise<AfterPatch | undefined> | AfterPatch | undefined;
}

export type HostEvent =
  | { readonly type: "tool_execution_start"; readonly id: string; readonly name: string }
  | { readonly type: "tool_execution_update"; readonly id: string; readonly name: string; readonly partial: ToolResult }
  | { readonly type: "tool_execution_end"; readonly id: string; readonly name: string; readonly isError: boolean }
  | { readonly type: "tool_result_message"; readonly id: string; readonly name: string; readonly isError: boolean };

export interface BatchOptions {
  readonly tools: readonly ToolDef[];
  readonly calls: readonly ToolCall[];
  readonly hooks?: Hooks;
  /** 宿主的默认模式；pi 是 parallel（agent/src/agent.ts:237） */
  readonly mode?: ExecutionMode;
  readonly signal?: AbortSignal;
  readonly ctx?: ToolContext;
  readonly emit?: (e: HostEvent) => void;
}

export interface BatchResult {
  readonly mode: ExecutionMode;
  readonly messages: readonly ToolResultMessage[];
  readonly terminate: boolean;
}

interface Outcome {
  readonly call: ToolCall;
  readonly result: ToolResult;
  readonly isError: boolean;
}

type Prepared = { readonly kind: "prepared"; readonly call: ToolCall; readonly tool: ToolDef; readonly args: unknown };
type Immediate = { readonly kind: "immediate"; readonly outcome: Outcome };

const errorResult = (message: string): ToolResult => ({ content: text(message), details: {} });
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const immediate = (call: ToolCall, message: string, terminate?: boolean): Immediate => ({
  kind: "immediate",
  outcome: { call, result: { ...errorResult(message), ...(terminate ? { terminate: true } : {}) }, isError: true },
});

async function prepare(o: BatchOptions, call: ToolCall): Promise<Prepared | Immediate> {
  const tool = o.tools.find((t) => t.name === call.name);
  if (!tool) return immediate(call, `Tool ${call.name} not found`);
  try {
    const raw = tool.prepareArguments ? tool.prepareArguments(call.arguments) : call.arguments;
    const args = validateArguments(tool.name, tool.parameters, raw);
    const decision = await o.hooks?.beforeToolCall?.(call, args);
    if (o.signal?.aborted) return immediate(call, "Operation aborted");
    if (decision?.block) return immediate(call, decision.reason || "Tool execution was blocked", decision.terminate === true);
    return { kind: "prepared", call, tool, args };
  } catch (e) {
    return immediate(call, messageOf(e));
  }
}

async function execute(o: BatchOptions, p: Prepared): Promise<Outcome> {
  let accepting = true;
  const onUpdate = (partial: ToolResult): void => {
    if (accepting) o.emit?.({ type: "tool_execution_update", id: p.call.id, name: p.call.name, partial });
  };
  try {
    const result = await p.tool.execute(p.call.id, p.args as never, o.signal, onUpdate, o.ctx ?? { cwd: process.cwd() });
    return { call: p.call, result, isError: false };
  } catch (e) {
    return { call: p.call, result: errorResult(messageOf(e)), isError: true };
  } finally {
    accepting = false;
  }
}

async function finalize(o: BatchOptions, p: Prepared, done: Outcome): Promise<Outcome> {
  if (!o.hooks?.afterToolCall) return done;
  try {
    const patch = await o.hooks.afterToolCall(p.call, p.args, done.result, done.isError);
    if (!patch) return done;
    const result: ToolResult = {
      ...done.result,
      content: patch.content ?? done.result.content,
      details: patch.details ?? done.result.details,
      terminate: patch.terminate ?? done.result.terminate,
    };
    return { call: p.call, result, isError: patch.isError ?? done.isError };
  } catch (e) {
    return { call: p.call, result: errorResult(messageOf(e)), isError: true };
  }
}

const toMessage = (x: Outcome): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: x.call.id,
  toolName: x.call.name,
  content: x.result.content ?? [],
  details: x.result.details,
  isError: x.isError,
});

const ended = (o: BatchOptions, x: Outcome): Outcome => {
  o.emit?.({ type: "tool_execution_end", id: x.call.id, name: x.call.name, isError: x.isError });
  return x;
};

const sent = (o: BatchOptions, x: Outcome): void =>
  o.emit?.({ type: "tool_result_message", id: x.call.id, name: x.call.name, isError: x.isError });

const run = async (o: BatchOptions, p: Prepared | Immediate): Promise<Outcome> =>
  p.kind === "immediate" ? p.outcome : finalize(o, p, await execute(o, p));

async function sequential(o: BatchOptions): Promise<Outcome[]> {
  const done: Outcome[] = [];
  for (const call of o.calls) {
    o.emit?.({ type: "tool_execution_start", id: call.id, name: call.name });
    const x = ended(o, await run(o, await prepare(o, call)));
    sent(o, x);
    done.push(x);
    if (o.signal?.aborted) break;
  }
  return done;
}

async function parallel(o: BatchOptions): Promise<Outcome[]> {
  const pending: (Outcome | (() => Promise<Outcome>))[] = [];
  for (const call of o.calls) {
    o.emit?.({ type: "tool_execution_start", id: call.id, name: call.name });
    const p = await prepare(o, call);
    pending.push(p.kind === "immediate" ? ended(o, p.outcome) : async () => ended(o, await run(o, p)));
    if (o.signal?.aborted) break;
  }
  const done = await Promise.all(pending.map((x) => (typeof x === "function" ? x() : x)));
  for (const x of done) sent(o, x);
  return done;
}

/** 有一个工具要求串行，整批就串行 */
export function batchMode(tools: readonly ToolDef[], calls: readonly ToolCall[], mode: ExecutionMode = "parallel"): ExecutionMode {
  const anySequential = calls.some((c) => tools.find((t) => t.name === c.name)?.executionMode === "sequential");
  return mode === "sequential" || anySequential ? "sequential" : "parallel";
}

export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const mode = batchMode(o.tools, o.calls, o.mode);
  const done = mode === "sequential" ? await sequential(o) : await parallel(o);
  return {
    mode,
    messages: done.map(toMessage),
    terminate: done.length > 0 && done.every((x) => x.result.terminate === true),
  };
}
