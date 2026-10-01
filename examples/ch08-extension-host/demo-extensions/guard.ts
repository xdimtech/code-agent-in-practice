// 照 pi 的 examples/extensions/protected-paths.ts 写的路径保护。
import type { ExtensionAPI } from "../src/types.ts";

const PROTECTED = [".env", ".git/"];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "write") return undefined;
    const path = String(event.input.path);
    return PROTECTED.some((p) => path.includes(p)) ? { block: true, reason: `「${path}」受保护` } : undefined;
  });
}
