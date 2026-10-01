import type { EventBus } from "./types.ts";

/** 扩展之间通信用的频道。它是一个活的资源，不是数据，所以没有不可变版本。 */
export function createEventBus(): EventBus {
  const channels = new Map<string, Set<(data: unknown) => void>>();
  return {
    emit(channel, data) {
      for (const handler of [...(channels.get(channel) ?? [])]) handler(data);
    },
    on(channel, handler) {
      const set = channels.get(channel) ?? new Set();
      set.add(handler);
      channels.set(channel, set);
      return () => {
        set.delete(handler);
      };
    },
    listenerCount(channel) {
      return channels.get(channel)?.size ?? 0;
    },
  };
}
