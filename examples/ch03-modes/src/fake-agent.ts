import { createLineReader, serializeLine } from "./jsonl.ts";

// 一个假的 `pi --mode rpc`：只模拟本章关心的几处行为，用来在真子进程上测 client.ts。
// - prompt 先回 success，再发事件，最后 agent_settled（pi `modes/rpc/rpc-mode.ts:394-416`）
// - 回复的文本里带 U+2028
// - 消息里有 "confirm" 就弹一个没有超时的确认框，等到回答才往下走
// - 解析不了的行回 command:"parse" 的错误；不认识的命令回 Unknown command（:715-718、:752-766）
// - stdin 关掉就退出（:804-807）

const write = (v: unknown) => process.stdout.write(serializeLine(v));
const waiting = new Map<string, (answer: Record<string, unknown>) => void>();
let dialogs = 0;

function finishTurn(text: string) {
  write({ type: "agent_start" });
  write({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
  write({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }] });
  write({ type: "agent_settled" });
}

function prompt(id: unknown, message: string) {
  write({ type: "response", id, command: "prompt", success: true });
  if (!message.includes("confirm")) return finishTurn(`第一段\u2028第二段：${message}`);
  const dialogId = `ui_${++dialogs}`;
  waiting.set(dialogId, (answer) => finishTurn(answer.cancelled === true ? "用户取消了" : `用户选了 ${String(answer.confirmed)}`));
  write({ type: "extension_ui_request", id: dialogId, method: "confirm", title: "危险命令", message: "rm -rf build" });
}

function handle(line: string) {
  let cmd: Record<string, unknown>;
  try {
    cmd = JSON.parse(line) as Record<string, unknown>;
  } catch (e) {
    return write({ type: "response", command: "parse", success: false, error: `Failed to parse command: ${(e as Error).message}` });
  }
  if (cmd.type === "extension_ui_response") {
    const resolve = waiting.get(String(cmd.id));
    waiting.delete(String(cmd.id));
    return resolve?.(cmd);
  }
  if (cmd.type === "prompt" && typeof cmd.message === "string") return prompt(cmd.id, cmd.message);
  write({ type: "response", id: cmd.id, command: String(cmd.type), success: false, error: `Unknown command: ${String(cmd.type)}` });
}

const reader = createLineReader({ onLine: handle, onOversize: () => process.exit(3) });
process.stdin.on("data", (chunk: Buffer) => reader.push(chunk));
process.stdin.on("end", () => {
  reader.end();
  process.exit(0);
});
