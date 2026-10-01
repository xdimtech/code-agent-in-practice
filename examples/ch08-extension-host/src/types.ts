// 扩展与宿主之间的全部契约。pi 的对应物是 core/extensions/types.ts 的 ExtensionAPI（:1252）。

/** pi 有 36 种事件（types.ts:1257-1301）；三种足够说明「通知」和「能拦截」的区别。 */
export type ExtensionEvent =
  | { type: "session_start" }
  | { type: "tool_call"; toolName: string; input: Readonly<Record<string, unknown>> }
  | { type: "tool_result"; toolName: string; output: string };

export type EventType = ExtensionEvent["type"];
export type EventOf<T extends EventType> = Extract<ExtensionEvent, { type: T }>;

/** 只有 tool_call 的返回值有意义：返回它就拦下这次调用。 */
export interface BlockResult {
  block: true;
  reason: string;
}

export type HandlerResult<T extends EventType> = T extends "tool_call" ? BlockResult | undefined : void;
export type Handler<T extends EventType> = (event: EventOf<T>) => HandlerResult<T> | Promise<HandlerResult<T>>;

/** 存起来的处理函数抹掉了具体类型；事件与参数的配对由 on() 的签名保证（pi 的 HandlerFn 同理）。 */
export interface HandlerEntry {
  event: EventType;
  handler: (event: ExtensionEvent) => unknown;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: Readonly<Record<string, unknown>>): string | Promise<string>;
}

export type FlagValue = boolean | string;

export interface EventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
  listenerCount(channel: string): number;
}

/** 工厂函数拿到的唯一对象。注意它没有任何「权限」概念——这正是本章的主题。 */
export interface ExtensionAPI {
  on<T extends EventType>(event: T, handler: Handler<T>): void;
  registerTool(tool: Tool): void;
  registerShortcut(key: string, description: string): void;
  registerFlag(name: string, defaultValue: FlagValue): void;
  readonly events: Pick<EventBus, "emit" | "on">;
}

/** pi：`export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;`（types.ts:1582） */
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

/** 加载成功之后的扩展记录。冻结：加载完成后谁也改不了它注册过什么。 */
export interface Extension {
  readonly path: string;
  readonly handlers: readonly HandlerEntry[];
  readonly tools: ReadonlyMap<string, Tool>;
  readonly shortcuts: readonly { key: string; description: string }[];
}
