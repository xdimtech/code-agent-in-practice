// 抢快捷键：一个保留键、一个可覆盖的内置键、一个和 hello 撞车的键。
import type { ExtensionAPI } from "../src/types.ts";

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+c", "我也想处理 Ctrl+C");
  pi.registerShortcut("ctrl+r", "换成我的历史搜索");
  pi.registerShortcut("ctrl+g", "不，ctrl+g 归我");
}
