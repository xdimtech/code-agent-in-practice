import { DIALOG_METHODS, NOTICE_METHODS } from "./types.ts";

// RPC 子进程 stdout 上的每一行，是三类东西之一：命令的响应、会话事件、扩展 UI 请求。
// 三类混在同一条流里，靠 type 字段区分（pi `modes/rpc/rpc-types.ts:116-281`、`modes/json-event.ts:17-18`）。

export type Incoming =
  | { readonly kind: "response"; readonly id?: string; readonly command: string; readonly success: boolean; readonly error?: string }
  | { readonly kind: "dialog"; readonly id: string; readonly method: string; readonly timeout?: number }
  | { readonly kind: "notice"; readonly method: string }
  | { readonly kind: "event"; readonly type: string; readonly value: Readonly<Record<string, unknown>> }
  | { readonly kind: "bad"; readonly reason: string };

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);
const dialogs: ReadonlySet<string> = new Set(DIALOG_METHODS);
const notices: ReadonlySet<string> = new Set(NOTICE_METHODS);

/** 外部输入：不信任，逐个字段看 */
export function classify(line: string): Incoming {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    return { kind: "bad", reason: `不是 JSON：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return { kind: "bad", reason: "没有字符串类型的 type 字段" };
  if (parsed.type === "response") return response(parsed);
  if (parsed.type === "extension_ui_request") return uiRequest(parsed);
  return { kind: "event", type: parsed.type, value: parsed };
}

function response(v: Readonly<Record<string, unknown>>): Incoming {
  if (typeof v.command !== "string" || typeof v.success !== "boolean") return { kind: "bad", reason: "响应缺 command 或 success" };
  return {
    kind: "response",
    command: v.command,
    success: v.success,
    ...(typeof v.id === "string" ? { id: v.id } : {}),
    ...(typeof v.error === "string" ? { error: v.error } : {}),
  };
}

function uiRequest(v: Readonly<Record<string, unknown>>): Incoming {
  if (typeof v.id !== "string" || typeof v.method !== "string") return { kind: "bad", reason: "UI 请求缺 id 或 method" };
  if (dialogs.has(v.method)) {
    return { kind: "dialog", id: v.id, method: v.method, ...(typeof v.timeout === "number" && v.timeout > 0 ? { timeout: v.timeout } : {}) };
  }
  if (notices.has(v.method)) return { kind: "notice", method: v.method };
  return { kind: "bad", reason: `不认识的 UI 方法：${v.method}` };
}

/** 回一个「取消」：select / input / editor 拿到 undefined，confirm 拿到 false（pi `modes/rpc/rpc-mode.ts:137-150`） */
export const cancelReply = (id: string) => ({ type: "extension_ui_response", id, cancelled: true }) as const;
