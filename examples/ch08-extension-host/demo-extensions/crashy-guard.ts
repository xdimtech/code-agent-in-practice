// 一个有 bug 的拦截器：假设 bash 调用一定带 command 字段。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command as string;
    return command.includes("rm -rf") ? { block: true, reason: "危险命令" } : undefined;
  });
}
