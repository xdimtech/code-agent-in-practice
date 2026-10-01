// 把层合计画成终端里的表。纯函数，输入两份（或一份）LayerTotal[]，输出字符串。

import { grandTotal, type LayerTotal } from "./layers.ts";

const BAR_WIDTH = 24;
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

/** 终端显示宽度：中日韩全角字符占两格 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

function padStart(s: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(s))) + s;
}

const fmt = (n: number): string => n.toLocaleString("en-US");
const pct = (part: number, whole: number): string => (whole === 0 ? "–" : `${((part / whole) * 100).toFixed(1)}%`);

function bar(part: number, whole: number): string {
  if (whole === 0 || part === 0) return "";
  return "█".repeat(Math.max(1, Math.round((part / whole) * BAR_WIDTH)));
}

export function renderSingle(title: string, rows: readonly LayerTotal[]): string {
  const total = grandTotal(rows);
  const labelWidth = Math.max(...rows.map((r) => displayWidth(r.name)), displayWidth(total.name));
  const lines = rows.map(
    (r) =>
      `  ${padEnd(r.name, labelWidth)}  ${padStart(fmt(r.lines), 7)}  ${padStart(pct(r.lines, total.lines), 6)}  ${bar(r.lines, total.lines)}`,
  );
  return [
    `${title}（${fmt(total.lines)} 行 / ${fmt(total.files)} 个文件）`,
    ...lines,
  ].join("\n");
}

function signed(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`;
}

/** 两个仓库按层名对齐；只在一边出现的层，另一边记 0 */
export function renderCompare(
  a: { readonly title: string; readonly rows: readonly LayerTotal[] },
  b: { readonly title: string; readonly rows: readonly LayerTotal[] },
): string {
  const names = [...new Set([...a.rows.map((r) => r.name), ...b.rows.map((r) => r.name)])];
  const linesOf = (rows: readonly LayerTotal[], name: string): number => rows.find((r) => r.name === name)?.lines ?? 0;
  const ta = grandTotal(a.rows).lines;
  const tb = grandTotal(b.rows).lines;
  const labelWidth = Math.max(...names.map(displayWidth), displayWidth("合计"));
  const wa = Math.max(7, displayWidth(a.title));
  const wb = Math.max(7, displayWidth(b.title));
  const row = (name: string, x: number, y: number): string =>
    `  ${padEnd(name, labelWidth)}  ${padStart(fmt(x), wa)}  ${padStart(fmt(y), wb)}  ${padStart(signed(y - x), 8)}`;
  return [
    `  ${padEnd("", labelWidth)}  ${padStart(a.title, wa)}  ${padStart(b.title, wb)}  ${padStart("Δ", 8)}`,
    ...names.map((n) => row(n, linesOf(a.rows, n), linesOf(b.rows, n))),
    row("合计", ta, tb),
  ].join("\n");
}
