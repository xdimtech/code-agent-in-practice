// 从 pi 的事件拼出审计记录的内容。纯函数：读文件、算时间都由调用方做。
// 参数原样记（审计要回答「到底跑了什么」）；工具输出只记摘要和大小——输出往往很大，也常带着密钥，
// 原文已经在会话里，审计日志只需要能证明「会话里那份没被换过」。

import { createHash } from "node:crypto";
import { toJson } from "./canonical.ts";
import { diffPaths } from "./drift.ts";
import type { Alg, Entry, Json } from "./types.ts";

export interface ContentDigest {
  readonly textBytes: number;
  readonly textSha256: string;
  readonly images: number;
  readonly imageBytes: number;
}

/** 完整输出文件（pi 截断时写到 tmpdir 的那个）的摘要；读不到就记原因 */
export type FileDigest = { readonly bytes: number; readonly sha256: string } | { readonly error: string };

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

type Part = { readonly type?: unknown; readonly text?: unknown; readonly data?: unknown };

export function digestContent(content: readonly unknown[]): ContentDigest {
  const parts = content.filter((p): p is Part => typeof p === "object" && p !== null);
  const text = parts.flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : [])).join("\n");
  const images = parts.flatMap((p) => (p.type === "image" && typeof p.data === "string" ? [p.data] : []));
  return {
    textBytes: Buffer.byteLength(text),
    textSha256: sha256(text),
    images: images.length,
    imageBytes: images.reduce((n, d) => n + Math.floor((d.length * 3) / 4), 0),
  };
}

export interface SessionInfo {
  readonly reason: string;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly previousSessionFile?: string;
  readonly alg: Alg;
}

export const sessionStarted = (info: SessionInfo): Entry => ({ kind: "session.started", body: toJson(info) });

export interface ToolCallInfo {
  readonly toolCallId: string;
  readonly toolName: string;
}

/** tool_execution_start：模型给的原样参数，每次调用都有，包括后来被拦下、参数校验不过的 */
export const toolProposed = (call: ToolCallInfo, args: unknown): Entry => ({ kind: "tool.proposed", body: toJson({ ...call, args }) });

export interface ExecutedInfo extends ToolCallInfo {
  /** tool_result.input：真正交给工具执行的参数 */
  readonly input: Record<string, unknown>;
  /** 同一个 toolCallId 在 tool.proposed 里记下的参数；没见到就是 undefined */
  readonly proposed: unknown;
  readonly content: readonly unknown[];
  readonly isError: boolean;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
  readonly fullOutput?: FileDigest;
}

export function toolExecuted(info: ExecutedInfo): Entry {
  const body = {
    toolCallId: info.toolCallId,
    toolName: info.toolName,
    input: info.input,
    drift: info.proposed === undefined ? null : diffPaths(info.proposed, info.input),
    isError: info.isError,
    output: digestContent(info.content),
    truncated: info.truncated,
    ...(info.fullOutputPath ? { fullOutput: { path: info.fullOutputPath, ...(info.fullOutput ?? { error: "没有读" }) } } : {}),
  };
  return { kind: "tool.executed", body: toJson(body) };
}

/** tool_execution_end：每次调用都有。没见到 tool_result 的，就是没执行（被拦、参数不对、工具不存在） */
export const toolSettled = (call: ToolCallInfo, isError: boolean, executed: boolean): Entry => ({
  kind: "tool.settled",
  body: toJson({ ...call, isError, executed }),
});

export interface UserBashInfo {
  readonly command: string;
  readonly cwd: string;
  readonly excludeFromContext: boolean;
}

/** user_bash：用户的 ! 命令。pi 没有对应的结束事件，这里只能记「要跑什么」 */
export const userBash = (info: UserBashInfo, refused?: string): Entry => ({
  kind: "user.bash",
  body: toJson({ ...info, ...(refused ? { refused } : {}) }),
});

export const isJsonRecord = (v: Json | undefined): v is { readonly [key: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);
