// 最普通的扩展：一个工具、一个事件处理、一个快捷键。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello",
    description: "打个招呼",
    execute: (input) => `Hello, ${String(input.name)}!`,
  });
  pi.on("session_start", () => pi.events.emit("log", "hello: 收到 session_start"));
  pi.events.on("demo:ping", () => pi.events.emit("log", "hello: 收到 demo:ping"));
  pi.registerShortcut("ctrl+g", "打招呼");
}
