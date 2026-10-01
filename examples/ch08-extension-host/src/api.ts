import type { EventBus, Extension, ExtensionAPI, FlagValue, HandlerEntry, Tool } from "./types.ts";

export interface Committed {
  extension: Extension;
  /** 这个扩展声明的 flag 默认值。和其他扩展共享，所以等工厂成功后才交出去。 */
  flags: ReadonlyMap<string, FlagValue>;
}

export interface LoadSession {
  api: ExtensionAPI;
  commit(): Committed;
  discard(): void;
}

/**
 * 给一个扩展造一份 API，外加「提交 / 丢弃」两个出口。
 * 对应 pi 的 createExtensionAPI（loader.ts:254-480）。
 *
 * 规则：工厂函数执行期间注册的一切只进暂存区；工厂成功才 commit，抛错就 discard。
 * 唯一不能暂存的是事件总线订阅——别的扩展可能在加载期间就发事件——所以照常订阅，
 * 记下退订函数，discard 时逐个退掉。
 */
export function createExtensionAPI(path: string, bus: EventBus): LoadSession {
  const handlers: HandlerEntry[] = [];
  const tools = new Map<string, Tool>();
  const shortcuts: { key: string; description: string }[] = [];
  const flags = new Map<string, FlagValue>();
  const unsubscribers: (() => void)[] = [];
  let state: "loading" | "active" | "failed" = "loading";

  const assertUsable = () => {
    if (state === "failed") throw new Error(`扩展「${path}」加载失败，它的 API 已失效`);
  };
  const assertLoading = (what: string) => {
    assertUsable();
    if (state !== "loading") throw new Error(`${what} 只能在工厂函数执行期间调用（扩展「${path}」）`);
  };

  const api: ExtensionAPI = {
    on(event, handler) {
      assertLoading("on");
      handlers.push({ event, handler: handler as HandlerEntry["handler"] });
    },
    registerTool(tool) {
      assertLoading("registerTool");
      tools.set(tool.name, tool);
    },
    registerShortcut(key, description) {
      assertLoading("registerShortcut");
      shortcuts.push({ key: key.toLowerCase(), description });
    },
    registerFlag(name, defaultValue) {
      assertLoading("registerFlag");
      flags.set(name, defaultValue);
    },
    events: {
      emit(channel, data) {
        assertUsable();
        bus.emit(channel, data);
      },
      on(channel, handler) {
        assertUsable();
        const off = bus.on(channel, handler);
        if (state === "loading") unsubscribers.push(off);
        return off;
      },
    },
  };

  return {
    api,
    commit() {
      if (state !== "loading") throw new Error(`扩展「${path}」不在加载中，不能提交`);
      state = "active";
      const extension: Extension = Object.freeze({
        path,
        handlers: Object.freeze([...handlers]),
        tools: new Map(tools),
        shortcuts: Object.freeze([...shortcuts]),
      });
      return { extension, flags: new Map(flags) };
    },
    discard() {
      if (state !== "loading") return;
      state = "failed";
      for (const off of unsubscribers) off();
    },
  };
}
