// session_start 处理函数抛错。宿主记下错误，继续调用后面的扩展。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    throw new Error("连不上遥测服务");
  });
}
