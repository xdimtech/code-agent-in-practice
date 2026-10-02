import { emitBeforeAgentStart, emitContext, type BeforeAgentStartHandler, type ContextHandler, type HandlerError, type Named } from "./inject.ts";
import type { Message, Request, ToolDef } from "./types.ts";

export interface SessionConfig {
  readonly tools: readonly ToolDef[];
  readonly baseSystemPrompt: string;
  readonly beforeAgentStart?: readonly Named<BeforeAgentStartHandler>[];
  readonly context?: readonly Named<ContextHandler>[];
  readonly reply: (turn: number) => string;
}

export interface SessionState {
  readonly turn: number;
  /** 持久的会话历史：before_agent_start 注入的消息会留在这里，context 钩子的改动不会。 */
  readonly history: readonly Message[];
}

export interface TurnResult {
  readonly request: Request;
  readonly state: SessionState;
  readonly errors: readonly HandlerError[];
}

export const EMPTY_SESSION: SessionState = { turn: 0, history: [] };

/**
 * 一轮用户输入的流程，照 agent-session.ts:1257-1306 与 sdk.ts:362-366：
 * 1. 用户消息在前，扩展消息跟在后面（源码 :1257 的注释说反了，以代码为准）
 * 2. 有人改 system prompt 就用改过的，没人改就退回基础版本
 * 3. 发请求前过一遍 context 钩子，改动只进这一次请求
 * 这里每轮只调一次模型；真实会话里一轮可能有多次工具往返，每次都会重跑第 3 步。
 */
export function runTurn(config: SessionConfig, state: SessionState, userText: string): TurnResult {
  const started = emitBeforeAgentStart(config.beforeAgentStart ?? [], userText, config.baseSystemPrompt);
  const history = [...state.history, { role: "user" as const, content: userText }, ...started.messages];
  const shaped = emitContext(config.context ?? [], history);
  const request: Request = { tools: config.tools, system: started.systemPrompt ?? config.baseSystemPrompt, messages: shaped.messages };
  const turn = state.turn + 1;
  return {
    request,
    state: { turn, history: [...history, { role: "assistant", content: config.reply(turn) }] },
    errors: [...started.errors, ...shaped.errors],
  };
}
