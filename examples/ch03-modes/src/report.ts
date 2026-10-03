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
