import { messageOf } from "./loader.ts";
import type { BlockResult, EventOf, EventType, Extension, ExtensionEvent } from "./types.ts";

export interface ExtensionError {
  path: string;
  event: EventType;
  message: string;
}

type NoticeEvent = Exclude<ExtensionEvent, { type: "tool_call" }>;

const handlersFor = (extension: Extension, type: EventType) =>
  extension.handlers.filter((entry) => entry.event === type).map((entry) => entry.handler);

/** 返回值来自扩展，是外部数据：只有 `block === true` 才算拦截，reason 缺了就补一个。 */
function asBlock(value: unknown): BlockResult | undefined {
  if (typeof value !== "object" || value === null || (value as { block?: unknown }).block !== true) return undefined;
  const reason = (value as { reason?: unknown }).reason;
  return { block: true, reason: typeof reason === "string" && reason !== "" ? reason : "被扩展拦截" };
}

/**
 * 通知类事件：每个处理函数单独 try/catch，出错记下来，接着调下一个（pi：runner.ts:850-880）。
 * 这是容错，不是隔离——出错的扩展和其他扩展、和宿主仍在同一个进程、同一个堆里。
 */
export async function emit(extensions: readonly Extension[], event: NoticeEvent): Promise<readonly ExtensionError[]> {
  const errors: ExtensionError[] = [];
  for (const extension of extensions) {
    for (const handler of handlersFor(extension, event.type)) {
      try {
        await handler(event);
      } catch (error) {
        errors.push({ path: extension.path, event: event.type, message: messageOf(error) });
      }
    }
  }
  return errors;
}

/**
 * tool_call：第一个返回 block 的处理函数说了算，后面的不再调用。
 * 刻意不 catch——和 pi 的 emitToolCall（runner.ts:982-1002）一样，把异常交给上一层。
 */
export async function emitToolCall(
  extensions: readonly Extension[],
  event: EventOf<"tool_call">,
): Promise<BlockResult | undefined> {
  for (const extension of extensions) {
    for (const handler of handlersFor(extension, "tool_call")) {
      const verdict = asBlock(await handler(event));
      if (verdict) return verdict;
    }
  }
  return undefined;
}

/**
 * 工具执行前的那道闸。拦截器自己出错时按「拦下」处理（fail-closed）：
 * 一个本该拦截危险命令的扩展崩了，宁可这次调用失败，也不能当它不存在。
 * pi 把这一步拆在两处：agent-session.ts:494-506 转成 Error，agent-loop.ts:659-664 变成错误结果。
 */
export async function beforeToolCall(
  extensions: readonly Extension[],
  event: EventOf<"tool_call">,
): Promise<BlockResult | undefined> {
  try {
    return await emitToolCall(extensions, event);
  } catch (error) {
    return { block: true, reason: `扩展出错，按拦截处理：${messageOf(error)}` };
  }
}
