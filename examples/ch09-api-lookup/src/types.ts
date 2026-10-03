// 本例的全部词汇。事件名照抄 pi `core/extensions/types.ts:1257-1301` 的 36 个 on() 重载，顺序也一样。

export const EVENT_NAMES = [
  "project_trust",
  "resources_discover",
  "session_start",
  "session_info_changed",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "context",
  "before_provider_request",
  "before_provider_headers",
  "after_provider_response",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "agent_settled",
  "ui_prompt_start",
  "ui_prompt_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "tool_call",
  "tool_result",
  "user_bash",
  "input",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** 事件在哪个阶段触发；反查表按它分组 */
export type Stage = "startup" | "input" | "run" | "turn" | "message" | "request" | "tool" | "session" | "model" | "ui";

/**
 * 多个处理函数都返回了东西时，宿主怎么合并。pi 的 runner 里每种合并对应一个 emitXxx 方法：
 * - notify：返回值被忽略，每个处理函数单独 try/catch（runner.ts:851-883）
 * - cancel：session_before_*，第一个 cancel 短路，否则最后一个非空结果胜出（runner.ts:863-867）
 * - first-decided：project_trust，第一个不是 undecided 的胜出（runner.ts:204-234）
 * - collect：resources_discover，所有路径收集到一起（runner.ts:1197-1243）
 * - chain：context / before_provider_request，前一个的输出是后一个的输入（runner.ts:1034-1098）
 * - in-place：before_provider_headers，就地改对象，返回值忽略（runner.ts:1100-1129）
 * - prompt：before_agent_start，message 累加、systemPrompt 串联（runner.ts:1131-1195）
 * - same-role：message_end，串联，但换了 role 的结果被拒（runner.ts:885-925）
 * - per-field：tool_result，content / details / isError / usage 逐字段串联（runner.ts:927-980）
 * - block：tool_call，第一个 block 短路，**不 catch**（runner.ts:982-1003）
 * - first-result：user_bash，第一个非空结果胜出（runner.ts:1005-1032）
 * - transform：input，transform 串联、handled 短路（runner.ts:1246-1285）
 */
export const MERGES = [
  "notify",
  "cancel",
  "first-decided",
  "collect",
  "chain",
  "in-place",
  "prompt",
  "same-role",
  "per-field",
  "block",
  "first-result",
  "transform",
] as const;

export type Merge = (typeof MERGES)[number];

export type Severity = "error" | "warn" | "info";

export interface Finding {
  readonly severity: Severity;
  readonly rule: string;
  /** trace 第几行（从 1 开始）；和整份 trace 有关的发现没有行号 */
  readonly line?: number;
  readonly message: string;
}

/** 命令行参数、文件内容这类外部输入有问题；main.ts 接住后退出 2 */
export class InputError extends Error {}
