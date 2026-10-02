// 演示用的磁带：不是真实录制，而是按演示会话推出来的——文件里每一条助手消息对应一次请求，
// 请求体取「那一刻的上下文」经 wire.ts 投影后的结果，形状是简化过的（真实请求体因 API 而异）。
// 这样磁带和会话对得上，演示不需要网络，也不需要装 pi。

import { createRecorder } from "./recorder.ts";
import { contextEntries, pathTo, type SessionTree } from "./tree.ts";
import { isAssistant, type Entry } from "./types.ts";
import { toWire } from "./wire.ts";

export const DEMO_SYSTEM = "You are an expert coding assistant operating inside pi, a coding agent harness.";
export const DEMO_TOOLS: readonly string[] = ["read", "bash", "edit", "write"];

export interface DemoRequest {
  readonly entry: Entry;
  readonly payload: unknown;
}

export function demoRequests(entries: readonly Entry[], tree: Pick<SessionTree, "byId">, system: string = DEMO_SYSTEM): DemoRequest[] {
  return entries.flatMap((entry) => {
    if (!isAssistant(entry.message) || entry.parentId === null) return [];
    const { messages } = toWire(contextEntries(pathTo(tree, entry.parentId)), { vision: true });
    const payload = {
      model: entry.message.model,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.text, ...(m.calls ? { tool_calls: m.calls.map((c) => ({ name: c.name, arguments: c.arguments })) } : {}) })),
      tools: DEMO_TOOLS.map((name) => ({ name })),
    };
    return [{ entry, payload }];
  });
}

/** 返回磁带文本（JSONL）。出错的那次请求只录到请求和助手消息，没有响应头 */
export function demoTape(requests: readonly DemoRequest[], sessionId: string): string {
  const lines: string[] = [];
  let at = "";
  const recorder = createRecorder({ now: () => at, append: (line) => lines.push(line) });
  for (const { entry, payload } of requests) {
    at = entry.timestamp;
    recorder.onRequest(payload, { sessionId, leafId: entry.parentId });
    if (isAssistant(entry.message) && entry.message.stopReason !== "error") {
      recorder.onResponse(200, { "Request-Id": `req_demo_${lines.length}`, "set-cookie": "sid=demo", "content-type": "text/event-stream" });
    }
    recorder.onAssistantMessage(entry.message);
  }
  return lines.join("");
}
