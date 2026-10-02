import { analyzeCommand } from "./command.ts";
import { gaps, type GateProfile, SURFACES } from "./coverage.ts";
import type { Sample } from "./corpus.ts";
import type { Outcome } from "./host.ts";
import { piGateFlags } from "./pi-gate.ts";
import type { Decision } from "./types.ts";

export const section = (title: string): void => console.log(`\n${title}`);

const VERDICT_LABEL: Readonly<Record<Decision["verdict"], string>> = { allow: "放行", ask: "要问", deny: "拒绝" };

export const formatDecision = (d: Decision): string => `${VERDICT_LABEL[d.verdict]}  [${d.rule}] ${d.reason}`;

export const formatOutcome = (o: Outcome): string => {
  const swallowed = o.swallowed.length > 0 ? `（宿主吞掉了错误：${o.swallowed.join("；")}）` : "";
  return o.ran ? `执行了${swallowed}` : `没执行：${o.reason}${swallowed}`;
};

/** 中文和全角符号占两格，按显示宽度补空格 */
const pad = (text: string, width: number): string => {
  const shown = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - shown));
};

export function analysisLabel(command: string): string {
  const { analysis } = analyzeCommand(command);
  if (analysis.kind === "matched") return `命中 ${analysis.rule}`;
  return analysis.kind === "unresolved" ? "看不全" : "普通";
}

export function printCorpus(samples: readonly Sample[]): void {
  console.log(`  ${pad("命令", 50)}${pad("实际", 8)}${pad("pi 正则", 10)}本例`);
  for (const s of samples) {
    const regex = piGateFlags(s.command) ? "要问" : "放行";
    console.log(`  ${pad(s.command, 50)}${pad(s.destructive ? "有破坏" : "无害", 8)}${pad(regex, 10)}${analysisLabel(s.command)}`);
  }
}

export function printCoverage(profiles: readonly GateProfile[]): void {
  const width = (p: GateProfile): number => Math.max(p.name.length, 4) + 3;
  console.log(`  ${pad("", 18)}${profiles.map((p) => pad(p.name, width(p))).join("")}`.trimEnd());
  for (const surface of SURFACES) {
    console.log(`  ${pad(surface, 18)}${profiles.map((p) => pad(p.covers.includes(surface) ? "管" : "—", width(p))).join("")}`.trimEnd());
  }
  console.log("  高等级缺口：");
  for (const p of profiles) {
    const serious = gaps(p).filter((g) => g.severity === "高");
    console.log(`    ${p.name}：${serious.length > 0 ? serious.map((g) => g.message).join("；") : "无"}`);
  }
}
