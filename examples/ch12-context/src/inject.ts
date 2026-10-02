import type { Message } from "./types.ts";

export interface BeforeAgentStartEvent {
  readonly prompt: string;
  /** 前面的处理器改过的 system prompt；第一个处理器拿到的是基础版本。 */
  readonly systemPrompt: string;
}

export interface BeforeAgentStartResult {
  readonly systemPrompt?: string;
  readonly message?: { readonly customType: string; readonly content: string };
}

export type BeforeAgentStartHandler = (event: BeforeAgentStartEvent) => BeforeAgentStartResult | undefined;
export type ContextHandler = (messages: readonly Message[]) => readonly Message[] | undefined;

export interface HandlerError {
  readonly handler: string;
  readonly event: "before_agent_start" | "context";
  readonly error: string;
}

export interface Named<T> {
  readonly name: string;
  readonly handler: T;
}

export interface BeforeAgentStartOutcome {
  /** undefined 表示这一轮没人改——会话应当退回基础版本，而不是沿用上一轮的覆盖。 */
  readonly systemPrompt?: string;
  readonly messages: readonly Message[];
  readonly errors: readonly HandlerError[];
}

/**
 * runner.ts:1131-1195 的规则：按注册顺序串行，system prompt 一个接一个地链下去，
 * 消息全部收集；某个处理器抛错只记下来，不影响别的处理器。
 */
export function emitBeforeAgentStart(handlers: readonly Named<BeforeAgentStartHandler>[], prompt: string, base: string): BeforeAgentStartOutcome {
  return handlers.reduce<BeforeAgentStartOutcome & { readonly current: string }>(
    (acc, { name, handler }) => {
      try {
        const result = handler({ prompt, systemPrompt: acc.current });
        if (!result) return acc;
        const messages = result.message ? [...acc.messages, { role: "user" as const, content: result.message.content, customType: result.message.customType }] : acc.messages;
        const current = result.systemPrompt ?? acc.current;
        return { ...acc, messages, current, systemPrompt: result.systemPrompt !== undefined ? current : acc.systemPrompt };
      } catch (error) {
        return { ...acc, errors: [...acc.errors, toError(name, "before_agent_start", error)] };
      }
    },
    { current: base, messages: [], errors: [] },
  );
}

/**
 * runner.ts:1034-1063：每次调模型之前跑一遍，拿到的是副本，返回值只影响这一次请求，不写回历史。
 * 本例的消息是只读的，所以「副本」就是同一个数组——处理器只能返回新数组。
 */
export function emitContext(handlers: readonly Named<ContextHandler>[], messages: readonly Message[]): { readonly messages: readonly Message[]; readonly errors: readonly HandlerError[] } {
  return handlers.reduce<{ readonly messages: readonly Message[]; readonly errors: readonly HandlerError[] }>(
    (acc, { name, handler }) => {
      try {
        return { ...acc, messages: handler(acc.messages) ?? acc.messages };
      } catch (error) {
        return { ...acc, errors: [...acc.errors, toError(name, "context", error)] };
      }
    },
    { messages, errors: [] },
  );
}

function toError(handler: string, event: HandlerError["event"], error: unknown): HandlerError {
  return { handler, event, error: error instanceof Error ? error.message : String(error) };
}
