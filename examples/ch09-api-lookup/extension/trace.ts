// pi 扩展：把 36 个扩展事件按触发顺序记成一份 trace，再用 `npm start -- order <trace.jsonl>` 检查顺序。用法：
//   pi -e ./extension/trace.ts --trace /tmp/pi-trace.jsonl
// 没给 --trace 就什么都不做。每行只有 seq、type 和少数几个标量字段（见 src/record.ts），不录内容。
// 三个照 pi 源码做的决定：
// 1. 旗标在事件里读，不在工厂函数里读：命令行给的值要等所有扩展加载完才写进去（core/agent-session-services.ts:93-113、:183），
//    工厂函数里 getFlag 只拿得到默认值（core/extensions/loader.ts:329-335、:355-359）。
// 2. 任何处理函数都不能抛错：tool_call 的错误不被 runner 接住，抛错等于拦下模型的工具调用（core/extensions/runner.ts:982-1003）。
//    写不进去就停止记录、提醒一次。
// 3. project_trust 记不到：它在项目信任判定的预加载里发，那一批扩展是单独加载的，旗标也还没写进去
//    （core/resource-loader.ts:380-400）。处理函数仍然必须返回 { trusted }，返回 undefined 会在宿主里抛 TypeError（runner.ts:218-219）。
// pi 的类型只写了用到的那几个成员；真实签名见 core/extensions/types.ts。

import { appendFileSync } from "node:fs";
import { shouldRecord, toRecord } from "../src/record.ts";
import { EVENT_NAMES, type EventName } from "../src/types.ts";

interface Ctx {
  readonly hasUI?: boolean;
  readonly ui?: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

interface Pi {
  registerFlag(name: string, options: { description?: string; type: "string" }): void;
  getFlag(name: string): boolean | string | undefined;
  on(event: EventName, handler: (event: unknown, ctx: Ctx) => unknown): void;
}

export interface Deps {
  /** 追加一行；失败就抛错 */
  readonly append: (path: string, line: string) => void;
  /** 没有界面时的提醒出口 */
  readonly warn: (message: string) => void;
}

export const FLAG = "trace";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createTraceExtension(deps: Deps): (pi: Pi) => void {
  return (pi) => {
    pi.registerFlag(FLAG, { description: "把扩展事件按顺序记到这个文件（JSONL，追加，不含内容）", type: "string" });
    let seq = 0;
    let seen: ReadonlySet<string> = new Set();
    let failed = false;

    const target = (): string | undefined => {
      const v = pi.getFlag(FLAG);
      return typeof v === "string" && v !== "" ? v : undefined;
    };

    const fail = (reason: string, ctx: Ctx) => {
      failed = true;
      const text = `trace 停止记录：${reason}`;
      if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "warning");
      else deps.warn(text);
    };

    const record = (type: EventName, event: unknown, ctx: Ctx) => {
      const file = target();
      if (!file || failed) return;
      const next = shouldRecord(type, event, seen);
      seen = next.seen;
      if (!next.record) return;
      seq += 1;
      try {
        deps.append(file, `${JSON.stringify(toRecord(type, event, seq))}\n`);
      } catch (e) {
        fail(message(e), ctx);
      }
    };

    for (const type of EVENT_NAMES) {
      if (type === "project_trust") {
        pi.on(type, () => ({ trusted: "undecided" }));
        continue;
      }
      pi.on(type, (event, ctx) => {
        try {
          record(type, event, ctx ?? {});
        } catch (e) {
          // 不能抛：tool_call 里抛错就是拦下工具调用
          if (!failed) fail(message(e), ctx ?? {});
        }
        return undefined;
      });
    }
  };
}

export default (pi: Pi): void =>
  createTraceExtension({
    append: (path, line) => appendFileSync(path, line, { encoding: "utf8", mode: 0o600 }),
    warn: (text) => process.stderr.write(`${text}\n`),
  })(pi);
