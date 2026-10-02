import { breaksInPatchReleases, countBreaking } from "./changelog.ts";
import { changeKind, upstreamStatus } from "./ledger.ts";
import type { EntryFate, Fate } from "./reconcile.ts";
import type { Tally } from "./triage.ts";
import { type FileState, type Finding, type LedgerEntry, NEEDS_HUMAN, type Release, type TriagedFile } from "./types.ts";

export const section = (title: string): void => console.log(`\n${title}`);

const SEVERITY_LABEL: Readonly<Record<Finding["severity"], string>> = { error: "错误", warn: "提醒", info: "说明" };

const STATE_LABEL: Readonly<Record<FileState, string>> = {
  untouched: "谁都没动",
  "take-upstream": "只有上游改了，拿新版",
  "keep-ours": "只有我们改了，保留",
  "same-change": "两边改成一样，补丁可撤",
  conflict: "两边都改了，要人合",
  "upstream-added": "上游新加",
  "ours-added": "我们新加",
  "upstream-deleted": "上游删了，跟着删",
  "deleted-but-ours-modified": "上游删了，我们却改过",
  "ours-deleted": "我们删了或挪了，上游没动",
  "ours-deleted-upstream-changed": "我们删了或挪了，上游却改了",
  "both-deleted": "两边都删了",
};

const FATE_LABEL: Readonly<Record<Fate, string>> = {
  rework: "要重做",
  carry: "原样带走",
  drop: "可以撤掉",
  stale: "不在树里",
  unlinked: "对不上文件",
};

/** 中文和全角符号占两格，按显示宽度补空格 */
const pad = (text: string, width: number): string => {
  const shown = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - shown));
};

const clip = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text);

export function printFindings(findings: readonly Finding[], limit = 12): void {
  if (findings.length === 0) return void console.log("  没发现问题");
  for (const f of findings.slice(0, limit)) console.log(`  ${SEVERITY_LABEL[f.severity]} [${f.rule}] ${f.message}`);
  if (findings.length > limit) console.log(`  …还有 ${findings.length - limit} 条`);
  const by = (s: Finding["severity"]): number => findings.filter((f) => f.severity === s).length;
  console.log(`  合计：错误 ${by("error")}，提醒 ${by("warn")}，说明 ${by("info")}`);
}

export function printReleases(releases: readonly Release[]): void {
  const breaking = releases.filter((r) => r.breaking.length > 0);
  console.log(`  ${releases.length} 个版本，其中 ${breaking.length} 个带破坏性变更，共 ${countBreaking(releases)} 条`);
  for (const r of breaking) {
    console.log(`  ${pad(r.version, 9)}${pad(r.date, 12)}${r.breaking.length} 条（第 ${r.line} 行）`);
    for (const b of r.breaking) console.log(`    · ${clip(b, 96)}`);
  }
  const patch = breaksInPatchReleases(releases);
  if (patch.length === 0) return void console.log("  补丁号里没有破坏性变更");
  console.log(`  只动了补丁号、却带破坏性变更的：${patch.map((p) => `${p.previous}→${p.release.version}`).join("，")}`);
}

const count = <T extends string>(items: readonly T[]): string =>
  [...items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<T, number>())].map(([k, n]) => `${k} ${n}`).join("，");

export function printLedger(entries: readonly LedgerEntry[]): void {
  if (entries.length === 0) return;
  const dates = entries.map((e) => e.date).sort();
  console.log(`  ${entries.length} 条，${dates[0]} 到 ${dates[dates.length - 1]}`);
  console.log(`  上游 PR：${count(entries.map(upstreamStatus))}`);
  console.log(`  改动性质：${count(entries.map(changeKind))}`);
}

export function printTally(counts: Tally, total: number): void {
  for (const state of Object.keys(STATE_LABEL) as FileState[]) {
    const n = counts.get(state) ?? 0;
    if (n > 0) console.log(`  ${pad(String(n), 5)}${pad(state, 31)}${STATE_LABEL[state]}${NEEDS_HUMAN.has(state) ? "  ←" : ""}`);
  }
  const human = [...counts].filter(([s]) => NEEDS_HUMAN.has(s)).reduce((n, [, c]) => n + c, 0);
  console.log(`  合计 ${total} 个路径，要人看的 ${human} 个`);
}

export function printFiles(files: readonly TriagedFile[], limit = 12): void {
  for (const f of files.slice(0, limit)) console.log(`    ${pad(f.state, 31)}${f.path}`);
  if (files.length > limit) console.log(`    …还有 ${files.length - limit} 个`);
}

export function printFates(fates: readonly EntryFate[]): void {
  for (const f of fates) console.log(`  ${pad(FATE_LABEL[f.fate], 12)}${f.entry.date}  ${clip(f.entry.title, 44)}${f.files.length ? `（${f.files.length} 个文件）` : ""}`);
}
