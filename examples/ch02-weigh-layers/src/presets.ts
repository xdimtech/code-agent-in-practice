// 分层预设。顺序就是优先级：先挑出内核文件，再挑出未接线的 v2 harness，
// 剩下的 agent 包才是在服役的 v1 运行时（见第 26、30 章）。
//
// 同一层在不同仓库里可能换了路径（Step-Code 把 packages/agent 改名为 packages/agent-core），
// 所以每个仓库一张表；层名相同，对照时按层名对齐。

import type { Layer } from "./layers.ts";

export const PI_LAYERS: readonly Layer[] = [
  { name: "内核 L1（agent-loop.ts）", prefixes: ["packages/agent/src/agent-loop.ts"] },
  { name: "v2 harness（未接线）", prefixes: ["packages/agent/src/harness/"] },
  { name: "运行时 v1（agent 其余）", prefixes: ["packages/agent/"] },
  { name: "Provider 适配（ai）", prefixes: ["packages/ai/"] },
  { name: "终端 UI（tui）", prefixes: ["packages/tui/"] },
  { name: "产品层（coding-agent）", prefixes: ["packages/coding-agent/"] },
  { name: "CLI 外壳（apps/cli）", prefixes: ["apps/cli/"] },
];

/** Step-Code `7dd66cb`：7 个 @step-harness/* 包 + apps/cli */
export const STEP_CODE_LAYERS: readonly Layer[] = [
  { name: "内核 L1（agent-loop.ts）", prefixes: ["packages/agent-core/src/agent-loop.ts"] },
  { name: "v2 harness（未接线）", prefixes: ["packages/agent-core/src/harness/"] },
  { name: "运行时 v1（agent 其余）", prefixes: ["packages/agent-core/"] },
  { name: "Provider 适配（ai）", prefixes: ["packages/providers/"] },
  { name: "终端 UI（tui）", prefixes: ["packages/tui/"] },
  { name: "产品层（coding-agent）", prefixes: ["packages/coding-agent/"] },
  { name: "CLI 外壳（apps/cli）", prefixes: ["apps/cli/"] },
];

export const PRESETS: Readonly<Record<string, readonly Layer[]>> = {
  pi: PI_LAYERS,
  "step-code": STEP_CODE_LAYERS,
};

/**
 * `--preset` 的取值：一个名字对所有仓库生效；`a,b` 给两个仓库各配一张表。
 * 认不出的名字返回 undefined，由调用方报错。
 */
export function resolvePresets(spec: string, repoCount: number): readonly (readonly Layer[])[] | undefined {
  const names = spec.split(",");
  if (names.length !== 1 && names.length !== repoCount) return undefined;
  const tables = names.map((n) => PRESETS[n.trim()]);
  if (tables.some((t) => t === undefined)) return undefined;
  return Array.from({ length: repoCount }, (_, i) => tables[names.length === 1 ? 0 : i] as readonly Layer[]);
}
