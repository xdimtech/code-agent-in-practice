// 一个假的 pi：记下注册的旗标和事件处理器，按 pi 的顺序手动触发。演示和测试用；没有对真实的 pi 跑过。
// 顺序照 agent/src/agent-loop.ts:442-470：tool_execution_start → tool_call → （执行）→ tool_result → tool_execution_end；
// tool_call 抛错或者 block 时跳过执行和 tool_result。

import type { LogIo } from "./writer.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;

export interface FakePi {
  readonly pi: {
    registerFlag(name: string): void;
    getFlag(name: string): string | undefined;
    on(event: string, handler: Handler): void;
  };
  fire(event: string, payload: unknown): unknown;
  has(event: string): boolean;
}

export const CTX = { sessionManager: { getSessionId: () => "019a-demo", getSessionFile: () => "/home/u/.pi/agent/sessions/--work-app--/2026-10-03T09-00-00_019a-demo.jsonl" } };

export function fakePi(flags: Readonly<Record<string, string>>): FakePi {
  const handlers = new Map<string, Handler>();
  return {
    pi: { registerFlag: () => undefined, getFlag: (name) => flags[name], on: (event, handler) => void handlers.set(event, handler) },
    fire: (event, payload) => handlers.get(event)?.(payload, CTX),
    has: (event) => handlers.has(event),
  };
}

export interface Call {
  readonly id: string;
  readonly tool: string;
  /** 模型给的参数 */
  readonly args: Record<string, unknown>;
  /** 校验、转换之后交给 tool_call 的那份；不给就和 args 一样 */
  readonly validated?: Record<string, unknown>;
  /** 别的扩展在 tool_call 里原地改参数（pi 的写法：mutate event.input） */
  readonly mutate?: (input: Record<string, unknown>) => void;
  readonly output?: string;
  readonly details?: Record<string, unknown>;
}

/** 按 pi 的顺序走完一次工具调用，返回「拦下的原因」或者 undefined */
export function runToolCall(fake: FakePi, call: Call): string | undefined {
  const base = { toolCallId: call.id, toolName: call.tool };
  fake.fire("tool_execution_start", { ...base, args: call.args });
  const input = structuredClone(call.validated ?? call.args);
  try {
    call.mutate?.(input);
    fake.fire("tool_call", { ...base, type: "tool_call", input });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    fake.fire("tool_execution_end", { ...base, isError: true });
    return reason;
  }
  fake.fire("tool_result", { ...base, input, content: [{ type: "text", text: call.output ?? "ok" }], details: call.details, isError: false });
  fake.fire("tool_execution_end", { ...base, isError: false });
  return undefined;
}

/** 内存里的日志；failAfter 次写入之后每次都抛 */
export function memoryIo(initial = "", failAfter = Number.POSITIVE_INFINITY): LogIo & { text(): string } {
  let text = initial;
  let writes = 0;
  return {
    read: () => (text === "" ? undefined : text),
    append(chunk) {
      if (writes >= failAfter) throw new Error("ENOSPC: no space left on device");
      writes++;
      text += chunk;
    },
    text: () => text,
  };
}
