// 演示和测试共用的 trace。都是手写的，没有对真实的 pi 跑过；顺序照 agent/src/agent-loop.ts 和 core/agent-session.ts 核对。

const line = (type: string, extra: Readonly<Record<string, unknown>> = {}) => JSON.stringify({ type, ...extra });

const TOOL = (id: string, name: string) => ({ toolCallId: id, toolName: name });

/** 一轮带两次工具调用的运行：一次正常执行，一次被 tool_call 拦下 */
export function goodTrace(): string {
  return [
    line("session_start", { reason: "startup" }),
    line("resources_discover", { reason: "startup" }),
    line("input", { source: "interactive" }),
    line("before_agent_start"),
    line("agent_start"),
    line("turn_start", { turnIndex: 0 }),
    line("message_start", { role: "user" }),
    line("message_end", { role: "user" }),
    line("context"),
    line("before_provider_headers"),
    line("before_provider_request"),
    line("after_provider_response", { status: 200 }),
    line("message_start", { role: "assistant" }),
    line("message_update", { role: "assistant" }),
    line("message_end", { role: "assistant", stopReason: "toolUse" }),
    line("tool_execution_start", TOOL("c1", "read")),
    line("tool_call", TOOL("c1", "read")),
    line("tool_result", { ...TOOL("c1", "read"), isError: false }),
    line("tool_execution_end", { ...TOOL("c1", "read"), isError: false }),
    line("message_start", { role: "toolResult" }),
    line("message_end", { role: "toolResult" }),
    line("tool_execution_start", TOOL("c2", "bash")),
    line("tool_call", TOOL("c2", "bash")),
    line("tool_execution_end", { ...TOOL("c2", "bash"), isError: true }),
    line("message_start", { role: "toolResult" }),
    line("message_end", { role: "toolResult" }),
    line("turn_end", { turnIndex: 0 }),
    line("turn_start", { turnIndex: 1 }),
    line("context"),
    line("before_provider_request"),
    line("message_start", { role: "assistant" }),
    line("message_end", { role: "assistant", stopReason: "stop" }),
    line("turn_end", { turnIndex: 1 }),
    line("agent_end"),
    line("agent_settled"),
    line("session_shutdown", { reason: "quit" }),
  ].join("\n");
}

/** 照 docs/extensions.md:275-349 的生命周期图写：用户消息在 turn_start 之前 */
export function docsOrderTrace(): string {
  return [
    line("before_agent_start"),
    line("agent_start"),
    line("message_start", { role: "user" }),
    line("message_end", { role: "user" }),
    line("turn_start", { turnIndex: 0 }),
    line("context"),
    line("before_provider_request"),
    line("message_start", { role: "assistant" }),
    line("message_end", { role: "assistant", stopReason: "stop" }),
    line("turn_end", { turnIndex: 0 }),
    line("agent_end"),
    line("agent_settled"),
  ].join("\n");
}

/** 一个自己拼事件、顺序写错了的 trace：先 tool_call 后 start，请求先于 context，settled 没有 agent_end */
export function badTrace(): string {
  return [
    line("agent_start"),
    line("turn_start", { turnIndex: 0 }),
    line("before_provider_request"),
    line("context"),
    line("message_start", { role: "assistant" }),
    line("message_end", { role: "assistant" }),
    line("tool_call", TOOL("c1", "bash")),
    line("tool_execution_start", TOOL("c1", "bash")),
    line("tool_result", TOOL("c1", "bash")),
    line("tool_execution_end", TOOL("c1", "bash")),
    "not json",
    line("auto_retry_start"),
    line("turn_end", { turnIndex: 0 }),
    line("agent_settled"),
  ].join("\n");
}

/** 自动重试：agent_end 之后又跑了一次，agent_settled 只在最后发一次（agent-session.ts:1106-1119） */
export function retryTrace(): string {
  const run = (stop: string) => [line("agent_start"), line("turn_start"), line("context"), line("before_provider_request"), line("message_start", { role: "assistant" }), line("message_end", { role: "assistant", stopReason: stop }), line("turn_end"), line("agent_end")];
  return [...run("error"), ...run("stop"), line("agent_settled")].join("\n");
}
