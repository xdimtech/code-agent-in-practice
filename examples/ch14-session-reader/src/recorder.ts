// pi 没有 provider 级别的请求记录，但留了钩子：before_provider_request 在请求体组装完、发出去之前触发
//（core/extensions/types.ts:693-697，core/sdk.ts:343-349），after_provider_response 在收到响应头之后触发（:709-714）。
// 这个模块把三类事件整理成「磁带」上的一行；写盘由调用方注入，这里不碰文件。
// 请求体里是完整的系统提示词、全部历史和工具参数，所以落盘前一律先脱敏。

import { createHash } from "node:crypto";
import { redactJson } from "./redact.ts";

export interface RequestRecord {
  readonly kind: "request";
  readonly seq: number;
  readonly at: string;
  readonly sessionId: string;
  /** 发请求时会话的叶子：用它把磁带和会话文件对上 */
  readonly leafId: string | null;
  /** 脱敏后请求体的指纹；回放时先比它 */
  readonly fingerprint: string;
  readonly redactedSecrets: number;
  readonly payload: unknown;
}

export interface ResponseRecord {
  readonly kind: "response";
  readonly seq: number;
  readonly at: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface MessageRecord {
  readonly kind: "message";
  readonly seq: number;
  readonly at: string;
  readonly message: unknown;
}

export type TapeRecord = RequestRecord | ResponseRecord | MessageRecord;

/** 响应头只留排障用得上的；set-cookie 之类一律不记 */
export const KEPT_HEADERS: readonly RegExp[] = [/^retry-after$/, /^(x-)?request-id$/, /ratelimit/, /^x-should-retry$/];

export function keepHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .filter(([k]) => KEPT_HEADERS.some((p) => p.test(k))),
  );
}

/** 键排序后的 JSON：同一个请求体不管对象键的顺序如何，指纹相同 */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const fingerprint = (v: unknown): string => createHash("sha256").update(canonical(v)).digest("hex").slice(0, 16);

export interface RecorderDeps {
  readonly now: () => string;
  /** 追加一行；抛错就让它抛，pi 的 runner 会接住并上报（core/extensions/runner.ts:1084-1092） */
  readonly append: (line: string) => void;
}

export interface RequestContext {
  readonly sessionId: string;
  readonly leafId: string | null;
}

export interface Recorder {
  /** 永远返回 undefined：这个钩子返回别的值就会替换真正发出去的请求体 */
  readonly onRequest: (payload: unknown, ctx: RequestContext) => undefined;
  readonly onResponse: (status: number, headers: Readonly<Record<string, string>>) => void;
  readonly onAssistantMessage: (message: unknown) => void;
}

export function createRecorder(deps: RecorderDeps): Recorder {
  let seq = 0; // 录制器自己的计数，不是会话状态
  const write = (record: TapeRecord) => deps.append(`${JSON.stringify(record)}\n`);
  return {
    onRequest(payload, ctx) {
      seq += 1;
      const { value, stats } = redactJson(payload);
      write({ kind: "request", seq, at: deps.now(), ...ctx, fingerprint: fingerprint(value), redactedSecrets: stats.secrets, payload: value });
      return undefined;
    },
    onResponse(status, headers) {
      write({ kind: "response", seq, at: deps.now(), status, headers: keepHeaders(headers) });
    },
    onAssistantMessage(message) {
      write({ kind: "message", seq, at: deps.now(), message: redactJson(message).value });
    },
  };
}
