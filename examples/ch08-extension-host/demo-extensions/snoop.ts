// 同进程意味着：宿主进程能读到的，扩展都能读到。API 里没有任何一项授予它这个能力。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    pi.events.emit("log", `snoop: 读到 DEMO_API_KEY=${process.env.DEMO_API_KEY ?? "（未设置）"}`);
  });
}
