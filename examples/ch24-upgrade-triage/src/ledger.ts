// 补丁台账：下游每改一处上游代码，记一条「为什么改、改了哪个包、能不能回上游、PR 开了没、怎么验证的」。
// 台账是给人读的 Markdown，但升级时要拿它和实际 diff 对账，所以格式得稳定到机器能读。

import type { Finding, LedgerEntry } from "./types.ts";

const ENTRY_HEADING = /^(#{2,4})\s+(\d{4}-\d{2}-\d{2})\s*(?:—|–|-|:)\s*(.+)$/;
const FIELD = /^-\s+([A-Za-z][A-Za-z ]{0,40}?):\s*(.*)$/;
const CODE_SPAN = /`([^`]+)`/g;
const FILE_LIKE = /^[\w.\-/]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)$/;

/** 必填字段，以及见过的别名。用了别名照收，但提示一下：对账脚本按字段名找东西 */
export const REQUIRED_FIELDS: ReadonlyArray<{ readonly name: string; readonly aliases: readonly string[] }> = [
  { name: "reason", aliases: [] },
  { name: "affected package", aliases: ["affected packages"] },
  { name: "change type", aliases: ["type"] },
  { name: "upstream pr", aliases: [] },
  { name: "validation", aliases: [] },
];

export type UpstreamStatus = "not-opened" | "opened" | "merged" | "unknown";
export type ChangeKind = "upstreamable" | "downstream-only" | "unknown";

export interface ParsedLedger {
  readonly entries: readonly LedgerEntry[];
  readonly findings: readonly Finding[];
}

interface Draft {
  readonly line: number;
  readonly level: number;
  readonly date: string;
  readonly title: string;
  readonly fields: Map<string, string>;
  readonly lines: string[];
}

function collect(text: string): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const heading = ENTRY_HEADING.exec(raw);
    if (heading) {
      current = { line: i + 1, level: heading[1].length, date: heading[2], title: heading[3].trim(), fields: new Map(), lines: [] };
      drafts.push(current);
      return;
    }
    if (/^#{1,4}\s/.test(raw)) return void (current = undefined);
    if (!current) return;
    current.lines.push(raw);
    const field = FIELD.exec(raw);
    if (field) current.fields.set(field[1].trim().toLowerCase(), field[2].trim());
  });
  return drafts;
}

export function mentionedPaths(fields: ReadonlyMap<string, string>, lines: readonly string[]): string[] {
  const explicit = (fields.get("files") ?? "").split(",").map((s) => s.replaceAll("`", "").trim()).filter(Boolean);
  const spans = lines.flatMap((l) => [...l.matchAll(CODE_SPAN)].map((m) => m[1].trim()));
  const fileLike = spans.filter((s) => FILE_LIKE.test(s) && !s.startsWith("@"));
  return [...new Set([...explicit, ...fileLike])];
}

const isRealDate = (d: string): boolean => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

function fieldFindings(d: Draft): Finding[] {
  const where = `第 ${d.line} 行「${d.date} ${d.title.slice(0, 40)}」`;
  return REQUIRED_FIELDS.flatMap(({ name, aliases }): Finding[] => {
    if (d.fields.has(name)) return [];
    const alias = aliases.find((a) => d.fields.has(a));
    if (alias) return [{ severity: "warn", rule: "field-alias", message: `${where} 用了「${alias}」，模板里叫「${name}」` }];
    return [{ severity: "error", rule: "missing-field", message: `${where} 缺「${name}」` }];
  });
}

function levelFindings(drafts: readonly Draft[]): Finding[] {
  const counts = new Map<number, number>();
  for (const d of drafts) counts.set(d.level, (counts.get(d.level) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return drafts
    .filter((d) => d.level !== usual)
    .map((d) => ({ severity: "error", rule: "heading-level", message: `第 ${d.line} 行用了 ${"#".repeat(d.level)}，其余条目都是 ${"#".repeat(usual ?? 3)}——按章节结构读的工具会把它当成另一节` }));
}

/** 约定新的在上。往回跳的条目逐条报出来——通常是插错了位置，或者是补记的 */
function orderFindings(drafts: readonly Draft[]): Finding[] {
  return drafts.flatMap((d, i): Finding[] =>
    i > 0 && d.date > drafts[i - 1].date
      ? [{ severity: "warn", rule: "out-of-order", message: `第 ${d.line} 行 ${d.date} 排在 ${drafts[i - 1].date} 后面` }]
      : [],
  );
}

export function parseLedger(text: string): ParsedLedger {
  const drafts = collect(text);
  const findings: Finding[] = [
    ...drafts.filter((d) => !isRealDate(d.date)).map((d): Finding => ({ severity: "error", rule: "bad-date", message: `第 ${d.line} 行日期 ${d.date} 不存在` })),
    ...levelFindings(drafts),
    ...drafts.flatMap(fieldFindings),
    ...orderFindings(drafts),
  ];
  if (drafts.length === 0) findings.push({ severity: "warn", rule: "empty", message: "没找到任何「日期 — 标题」形式的条目" });
  const entries = drafts.map((d): LedgerEntry => ({
    line: d.line,
    date: d.date,
    title: d.title,
    fields: new Map(d.fields),
    paths: mentionedPaths(d.fields, d.lines),
  }));
  return { entries, findings };
}

const field = (e: LedgerEntry, name: string): string => {
  const spec = REQUIRED_FIELDS.find((f) => f.name === name);
  const keys = [name, ...(spec?.aliases ?? [])];
  return keys.map((k) => e.fields.get(k)).find((v) => v !== undefined) ?? "";
};

export function upstreamStatus(e: LedgerEntry): UpstreamStatus {
  const text = field(e, "upstream pr").toLowerCase();
  if (!text) return "unknown";
  if (/\bmerged\b/.test(text)) return "merged";
  if (/\bnot (?:opened|created)\b/.test(text)) return "not-opened";
  return /#\d+|\/pull\/\d+/.test(text) ? "opened" : "unknown";
}

export function changeKind(e: LedgerEntry): ChangeKind {
  const text = field(e, "change type").toLowerCase();
  if (/specific|glue/.test(text) && !/generic|upstream/.test(text)) return "downstream-only";
  return /generic|upstream/.test(text) ? "upstreamable" : "unknown";
}
