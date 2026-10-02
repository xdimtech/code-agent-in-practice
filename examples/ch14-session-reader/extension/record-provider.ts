// pi 扩展：把每一次 provider 请求录成磁带。用法：
//   pi -e ./extension/record-provider.ts --tape /tmp/pi-tape.jsonl
// 没给 --tape 就什么都不做。磁带用 0600 创建；请求体落盘前已脱敏（src/recorder.ts），但规则是启发式的，用完就删。
// 两件事要知道：压缩和分支摘要的请求不经过这个钩子，磁带里没有；被重试或最终失败的响应，多数 provider 上不触发
// after_provider_response，磁带里只有请求、没有响应头。
// pi 的类型只写了用到的那几个成员；真实签名见 core/extensions/types.ts:1259-1345。

import { appendFileSync } from "node:fs";
import { createRecorder } from "../src/recorder.ts";

interface Ctx {
  readonly sessionManager: { getSessionId(): string; getLeafId(): string | null };
}

interface Pi {
  registerFlag(name: string, options: { description?: string; type: "string" }): void;
  getFlag(name: string): boolean | string | undefined;
  on(event: "before_provider_request", handler: (event: { payload: unknown }, ctx: Ctx) => undefined): void;
  on(event: "after_provider_response", handler: (event: { status: number; headers: Record<string, string> }) => void): void;
  on(event: "message_end", handler: (event: { message: { role: string } }) => void): void;
}

export const FLAG = "tape";

export default function (pi: Pi): void {
  pi.registerFlag(FLAG, { description: "把 provider 请求录到这个文件（JSONL，追加）", type: "string" });
  const target = (): string | undefined => {
    const v = pi.getFlag(FLAG);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const recorder = createRecorder({
    now: () => new Date().toISOString(),
    append: (line) => {
      const file = target();
      if (file) appendFileSync(file, line, { mode: 0o600 }); // 写不进去就抛：runner 会接住并上报，请求照常发出
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!target()) return undefined;
    return recorder.onRequest(event.payload, { sessionId: ctx.sessionManager.getSessionId(), leafId: ctx.sessionManager.getLeafId() });
  });
  pi.on("after_provider_response", (event) => {
    if (target()) recorder.onResponse(event.status, event.headers);
  });
  pi.on("message_end", (event) => {
    if (target() && event.message.role === "assistant") recorder.onAssistantMessage(event.message);
  });
}
