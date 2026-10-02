// 宿主侧的两条分发路径，按 pi 的行为写的最小模型，用来演示两件事：
// 模型的工具调用和用户的 ! 命令走的是两个不同的事件；这两个事件在处理器抛错时的结局相反。

export interface ToolCallEvent {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
}
export interface ToolCallResult {
  readonly block: true;
  readonly reason: string;
}
export type ToolCallHandler = (event: ToolCallEvent) => Promise<ToolCallResult | undefined> | ToolCallResult | undefined;

export interface UserBashEvent {
  readonly command: string;
  readonly cwd: string;
}
/** pi 的 BashResult（core/bash-executor.ts:29-40）里本例用到的字段 */
export interface BashResult {
  readonly output: string;
  readonly exitCode: number | undefined;
  readonly cancelled: boolean;
  readonly truncated: boolean;
}
/** user_bash 的返回值里没有 block：想拦，只能自己给一个结果顶替执行（core/extensions/types.ts:1137-1142） */
export interface UserBashResult {
  readonly result: BashResult;
}
export type UserBashHandler = (event: UserBashEvent) => Promise<UserBashResult | undefined> | UserBashResult | undefined;

export interface Outcome {
  readonly ran: boolean;
  readonly reason?: string;
  /** 处理器抛出、被宿主吞掉的错误 */
  readonly swallowed: readonly string[];
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 模型的工具调用。处理器之间没有 try/catch（core/extensions/runner.ts:982-1003），
 * 抛出的错误一路传到循环，在那里变成一条错误结果（agent/src/agent-loop.ts:659-665）：工具没有执行。
 */
export async function dispatchToolCall(handlers: readonly ToolCallHandler[], event: ToolCallEvent): Promise<Outcome> {
  try {
    for (const handler of handlers) {
      const result = await handler(event);
      if (result?.block) return { ran: false, reason: result.reason, swallowed: [] };
    }
  } catch (error) {
    return { ran: false, reason: message(error), swallowed: [] };
  }
  return { ran: true, swallowed: [] };
}

/**
 * 用户的 ! 命令。每个处理器单独 try/catch，抛错只上报、不中断（core/extensions/runner.ts:1005-1030）；
 * 没有处理器给出 result，命令就照常在本机执行（modes/interactive/interactive-mode.ts:6470、:6516）。
 */
export async function dispatchUserBash(handlers: readonly UserBashHandler[], event: UserBashEvent): Promise<Outcome> {
  const swallowed: string[] = [];
  for (const handler of handlers) {
    try {
      const result = await handler(event);
      if (result) return { ran: false, reason: result.result.output, swallowed };
    } catch (error) {
      swallowed.push(message(error));
    }
  }
  return { ran: true, swallowed };
}
