// pi 的分层预设。顺序就是优先级：先挑出 794 行的内核文件，再挑出未接线的 v2 harness，
// 剩下的 packages/agent 才是在服役的 v1 运行时（见第 26、30 章）。

import type { Layer } from "./layers.ts";

export const PI_LAYERS: readonly Layer[] = [
  { name: "内核 L1（agent-loop.ts）", prefixes: ["packages/agent/src/agent-loop.ts"] },
  { name: "v2 harness（未接线）", prefixes: ["packages/agent/src/harness/"] },
  { name: "运行时 v1（agent 其余）", prefixes: ["packages/agent/"] },
  { name: "Provider 适配（ai）", prefixes: ["packages/ai/"] },
  { name: "终端 UI（tui）", prefixes: ["packages/tui/"] },
  { name: "产品层（coding-agent）", prefixes: ["packages/coding-agent/"] },
];

export const PRESETS: Readonly<Record<string, readonly Layer[]>> = { pi: PI_LAYERS };
