// 注册了一个 flag、订阅了一个频道，然后抛错。加载器必须把这两件事都撤销。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("broken-mode", true);
  pi.events.on("demo:ping", () => pi.events.emit("log", "broken: 不该被调到"));
  throw new Error("配置文件缺字段 apiBase");
}
