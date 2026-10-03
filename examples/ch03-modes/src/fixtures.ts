import { serializeLine } from "./jsonl.ts";

// 演示和测试共用的输入。U+2028 用 fromCharCode 拼出来，免得源文件里出现一个看不见的换行符。

export const LS = String.fromCharCode(0x2028);
export const PS = String.fromCharCode(0x2029);

/** 一条合法的事件：文本里有 U+2028。JSON.stringify 不转义它，所以它原样出现在 JSONL 的一行里 */
export const EVENT_WITH_LS = serializeLine({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `第一段${LS}第二段` } });

const header = { type: "session", version: 3, id: "s1", timestamp: "2026-10-03T09:00:00.000Z", cwd: "/w" };
const assistant = (stopReason: string) => ({ role: "assistant", content: [{ type: "text", text: "完成" }], stopReason });

/** `pi --mode json -p ...` 录下来的样子：会话头、事件、agent_end */
export function jsonCapture(stopReason = "stop"): string {
  return [header, { type: "agent_start" }, JSON.parse(EVENT_WITH_LS), { type: "agent_end", messages: [assistant(stopReason)] }, { type: "agent_settled" }].map(serializeLine).join("");
}

/** `--mode rpc` 一轮的样子：响应、对话框请求（没有超时）、事件 */
export function rpcCapture(): string {
  return [
    { type: "response", id: "req_1", command: "prompt", success: true },
    { type: "extension_ui_request", id: "ui_1", method: "confirm", title: "危险命令", message: "rm -rf build" },
    { type: "extension_ui_request", id: "ui_2", method: "select", title: "选一个", options: ["a", "b"], timeout: 30000 },
    { type: "extension_ui_request", id: "n1", method: "notify", message: "开始了" },
    { type: "response", id: "req_2", command: "set_model", success: false, error: "Model not found" },
    { type: "agent_settled" },
  ]
    .map(serializeLine)
    .join("");
}
