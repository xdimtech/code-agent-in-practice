// pi 扩展：把工具调用和用户 ! 命令写进一条带哈希链的审计日志。用法：
//   AUDIT_LOG_HMAC_KEY="$(openssl rand -hex 32)" pi -e ./extension/audit-log.ts --audit-log ~/audit/pi.jsonl
// 没给 --audit-log 就什么都不做。没设密钥就用 sha256（只防意外损坏）；设了但不到 32 字节，所有工具调用都会被拦下。
// 每次调用记三到四条：tool.proposed（模型给的参数）→ tool.executed（真正执行的参数、两者差在哪、输出摘要）→ tool.settled。
// 被拦下的调用没有 tool_result 事件（agent/src/agent-loop.ts:450-468），所以只有 proposed 和 settled，settled 里 executed=false。
// 日志写不进去时：模型的工具调用在 tool_call 里抛错拦下（抛错 = 不执行）；用户的 ! 命令在 user_bash 里返回一个顶替结果
// （这里抛错会被吞掉、命令照常执行，见第 15 章）。
// 扩展装上时就把密钥从 process.env 里拿走：pi 的 bash 工具和用户 ! 命令都继承整个 process.env（utils/shell.ts:147-149），
// 留在那里，模型一条 env 就能读到。
// pi 的类型只写了用到的那几个成员；真实签名见 core/extensions/types.ts。

import { KEY_ENV, keyFromEnv } from "../src/key.ts";
import { fileDigest, fileIo } from "../src/load.ts";
import { type FileDigest, sessionStarted, toolExecuted, toolProposed, toolSettled, userBash } from "../src/records.ts";
import type { Entry } from "../src/types.ts";
import { type AuditWriter, type LogIo, openAuditWriter } from "../src/writer.ts";

interface Ctx {
  readonly sessionManager: { getSessionId(): string; getSessionFile(): string | undefined };
}

interface ToolEvent {
  readonly toolCallId: string;
  readonly toolName: string;
}

interface ToolResultEvent extends ToolEvent {
  readonly input: Record<string, unknown>;
  readonly content: readonly unknown[];
  readonly details: { readonly truncation?: { readonly truncated?: boolean }; readonly fullOutputPath?: string } | undefined;
  readonly isError: boolean;
}

interface UserBashEvent {
  readonly command: string;
  readonly cwd: string;
  readonly excludeFromContext?: boolean;
}

/** pi 的 BashResult（core/bash-executor.ts:29-40） */
interface BashResult {
  readonly output: string;
  readonly exitCode: number | undefined;
  readonly cancelled: boolean;
  readonly truncated: boolean;
}

interface Pi {
  registerFlag(name: string, options: { description?: string; type: "string" }): void;
  getFlag(name: string): boolean | string | undefined;
  on(event: "session_start", handler: (event: { reason: string; previousSessionFile?: string }, ctx: Ctx) => void): void;
  on(event: "session_shutdown", handler: (event: { reason: string }) => void): void;
  on(event: "tool_execution_start", handler: (event: ToolEvent & { args: unknown }) => void): void;
  on(event: "tool_call", handler: (event: ToolEvent & { input: Record<string, unknown> }) => undefined): void;
  on(event: "tool_result", handler: (event: ToolResultEvent) => undefined): void;
  on(event: "tool_execution_end", handler: (event: ToolEvent & { isError: boolean }) => void): void;
  on(event: "user_bash", handler: (event: UserBashEvent) => { result: BashResult } | undefined): void;
}

export interface Deps {
  readonly openIo: (path: string) => LogIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => string;
  readonly fileDigest: (path: string) => FileDigest;
}

export const FLAG = "audit-log";

const callOf = (e: ToolEvent): ToolEvent => ({ toolCallId: e.toolCallId, toolName: e.toolName });

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const refusal = (reason: string): BashResult => ({ output: `审计日志不可用，命令没有执行：${reason}\n`, exitCode: 1, cancelled: false, truncated: false });

/** 取走密钥，返回只含密钥的快照。只是少一处暴露：进程启动时的环境块（Linux 的 /proc/<pid>/environ、ps eww）里仍然有，
 *  同一用户跑的命令照样读得到；要防模型本身，密钥就不能进这个进程。这里有意改传进来的对象 */
export function takeKey(env: Record<string, string | undefined>): Record<string, string> {
  const raw = env[KEY_ENV];
  delete env[KEY_ENV];
  return raw === undefined ? {} : { [KEY_ENV]: raw };
}

export function createAuditExtension(deps: Deps): (pi: Pi) => void {
  return (pi) => {
    pi.registerFlag(FLAG, { description: "把工具调用写进这个审计日志（JSONL，哈希链，追加）", type: "string" });
    let writer: AuditWriter | undefined;
    let failure: string | undefined;
    const proposed = new Map<string, unknown>();
    const executed = new Set<string>();

    const target = (): string | undefined => {
      const v = pi.getFlag(FLAG);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    /** 第一次用到时打开；密钥不合格、已有日志校验不过，都记成 failure，之后每次调用都拦 */
    const open = (file: string): AuditWriter | undefined => {
      if (writer || failure) return writer;
      try {
        writer = openAuditWriter({ io: deps.openIo(file), key: keyFromEnv(deps.env), now: deps.now });
      } catch (e) {
        failure = message(e);
      }
      return writer;
    };
    const blocked = (): string | undefined => failure ?? writer?.degraded();
    /** 拼记录和写记录都可能失败；失败就进入降级，而不是让 runner 接住、报一句了事 */
    const write = (build: () => Entry): boolean => {
      const file = target();
      if (!file || !open(file) || blocked()) return false;
      try {
        return writer?.append(build()) !== undefined;
      } catch (e) {
        failure = `记录拼不出来：${message(e)}`;
        return false;
      }
    };

    pi.on("session_start", (event, ctx) => {
      write(() => sessionStarted({ reason: event.reason, sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), previousSessionFile: event.previousSessionFile, alg: deps.env[KEY_ENV] ? "hmac-sha256" : "sha256" }));
    });
    pi.on("session_shutdown", (event) => void write(() => ({ kind: "session.ended", body: { reason: event.reason } })));

    pi.on("tool_execution_start", (event) => {
      if (!target()) return;
      proposed.set(event.toolCallId, event.args);
      write(() => toolProposed(callOf(event), event.args));
    });

    pi.on("tool_call", (event) => {
      const file = target();
      if (!file) return undefined;
      open(file);
      const reason = blocked();
      if (reason) throw new Error(`审计日志不可用，拒绝执行 ${event.toolName}：${reason}`);
      return undefined;
    });

    pi.on("tool_result", (event) => {
      if (!target()) return undefined;
      executed.add(event.toolCallId);
      const path = event.details?.fullOutputPath;
      write(() => toolExecuted({ toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, proposed: proposed.get(event.toolCallId), content: event.content, isError: event.isError, truncated: event.details?.truncation?.truncated === true, ...(path ? { fullOutputPath: path, fullOutput: deps.fileDigest(path) } : {}) }));
      return undefined;
    });

    pi.on("tool_execution_end", (event) => {
      if (!target()) return;
      write(() => toolSettled(callOf(event), event.isError, executed.has(event.toolCallId)));
      proposed.delete(event.toolCallId);
      executed.delete(event.toolCallId);
    });

    pi.on("user_bash", (event) => {
      const file = target();
      if (!file) return undefined;
      try {
        open(file);
        const info = { command: event.command, cwd: event.cwd, excludeFromContext: event.excludeFromContext === true };
        if (write(() => userBash(info))) return undefined;
        return { result: refusal(blocked() ?? "写入失败") };
      } catch (e) {
        return { result: refusal(message(e)) }; // 不能抛：user_bash 的错误被吞掉，命令照常执行
      }
    });
  };
}

/** 在 pi 调用时才取走密钥，而不是在模块加载时——演示和测试也会 import 这个文件 */
export default (pi: Pi): void => createAuditExtension({ openIo: fileIo, env: takeKey(process.env), now: () => new Date().toISOString(), fileDigest })(pi);
