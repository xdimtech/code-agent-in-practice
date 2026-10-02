import type { SessionFacts } from "./session-check.ts";
import type { AuditRecord, Finding } from "./types.ts";
import type { Verification } from "./verify.ts";

export const section = (title: string): void => console.log(`\n${title}`);

const SEVERITY_LABEL: Readonly<Record<Finding["severity"], string>> = { error: "错误", warn: "提醒", info: "说明" };

/** 中文和全角符号占两格，按显示宽度补空格 */
export const pad = (text: string, width: number): string => {
  const shown = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - shown));
};

export const clip = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text);

export function printFindings(findings: readonly Finding[], limit = 12): void {
  if (findings.length === 0) return void console.log("  没发现问题");
  for (const f of findings.slice(0, limit)) console.log(`  ${SEVERITY_LABEL[f.severity]} [${f.rule}]${f.line ? ` 第 ${f.line} 行` : ""} ${clip(f.message, 110)}`);
  if (findings.length > limit) console.log(`  …还有 ${findings.length - limit} 条`);
}

export function printVerification(v: Verification): void {
  const verdict = v.brokenAt ? `第 ${v.brokenAt} 行断开` : v.findings.some((f) => f.severity === "error") ? "链完好，但和锚点对不上" : "通过";
  console.log(`  ${v.lines} 行，${v.records.length} 条可信，结论：${verdict}`);
  printFindings(v.findings);
}

export function printRecords(records: readonly AuditRecord[]): void {
  for (const r of records) {
    const body = JSON.stringify(r.body);
    console.log(`  #${pad(String(r.seq), 3)}${pad(r.kind, 16)}${r.hash.slice(0, 10)}  ${clip(body, 84)}`);
  }
}

export function printFacts(f: SessionFacts): void {
  console.log(`  ${f.entries} 条可读条目；工具调用 ${f.toolCalls}，结果 ${f.toolResults}（其中报错 ${f.toolErrors}）；用户 ! 命令 ${f.userBash}`);
  console.log(`  完整输出在会话外的 ${f.externalOutputs.length} 处；内联图片 ${f.images} 张约 ${f.imageBytes} 字节`);
}
