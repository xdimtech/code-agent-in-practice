import { canChange, type EventInfo, STAGE_TITLES } from "./catalog.ts";
import type { MergeResult } from "./merge.ts";
import type { Task } from "./tasks.ts";
import type { Finding } from "./types.ts";

const MARK = { error: "✗", warn: "!", info: "·" } as const;

export function formatFinding(f: Finding): string {
  const where = f.line === undefined ? "" : `第 ${f.line} 行 `;
  return `  ${MARK[f.severity]} ${where}${f.rule}：${f.message}`;
}

export function printFindings(findings: readonly Finding[], limit: number): void {
  if (findings.length === 0) {
    console.log("  没有发现问题");
    return;
  }
  for (const f of findings.slice(0, limit)) console.log(formatFinding(f));
  if (findings.length > limit) console.log(`  ……另有 ${findings.length - limit} 条`);
}

export function formatEvent(e: EventInfo): string {
  return [
    `${e.name}（${STAGE_TITLES[e.stage]}）`,
    `  能做什么：${e.can}`,
    `  多个处理函数：${e.merge}${canChange(e) ? "" : "（返回值被忽略）"}`,
    `  在哪里发：${e.emittedAt}`,
  ].join("\n");
}

export function formatTask(t: Task): string {
  const lines = [`${t.want}`, `  用：${t.use.join("；")}`];
  if (t.notThis) lines.push(`  别用：${t.notThis}`);
  lines.push(`  坑：${t.pitfall}`, `  示例：${t.example}`);
  return lines.join("\n");
}

const show = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));

export function formatMerge(r: MergeResult): string {
  const lines = [`  调用了：${r.called.join(" → ") || "（没有）"}`, `  宿主拿到：${show(r.outcome)}`];
  for (const e of r.errors) lines.push(`  记成扩展错误：${e}`);
  if (r.threw) lines.push(`  抛给宿主：${r.threw}`);
  return lines.join("\n");
}
