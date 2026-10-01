// 把审计结果画成终端表格。纯函数，输入 Row[]，输出字符串。

import type { Hit, Row, Status } from "./classify.ts";

const STATUSES: readonly Status[] = ["有", "未接线", "声明过时", "决定不做", "没做"];
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

/** 终端显示宽度：中日韩全角字符占两格 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

const pad = (s: string, width: number): string => s + " ".repeat(Math.max(0, width - displayWidth(s)));
const at = (h: Hit): string => `${h.file}:${h.line}`;

/** 优先引用定义处（export 开头的行），其次是第一个命中——import 和注释说明不了「实现在这」 */
export function strongest(hits: readonly Hit[]): Hit | undefined {
  return hits.find((h) => h.text.startsWith("export ")) ?? hits[0];
}

/** 每种状态最能说明问题的那条证据 */
export function citation(row: Row): string {
  const present = strongest(row.evidence.present);
  const declared = row.evidence.declared[0];
  switch (row.status) {
    case "有":
      return at(present!);
    case "未接线":
      return `${at(present!)}（0 个调用点）`;
    case "声明过时":
      return `${at(present!)} ↔ ${at(declared!)}`;
    case "决定不做":
      return at(declared!);
    case "没做":
      return "—";
  }
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(displayWidth(h), ...body.map((r) => displayWidth(r[i] ?? ""))));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : pad(c, widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(header), ...body.map(line)].join("\n");
}

export function tally(rows: readonly Row[]): string {
  return STATUSES.map((s) => `${s} ${rows.filter((r) => r.status === s).length}`).join(" · ");
}

export function renderSingle(title: string, rows: readonly Row[]): string {
  const body = rows.map((r) => [r.status, r.capability.name, citation(r)]);
  return [`${title}：${rows.length} 项能力`, "", table(["状态", "能力", "证据"], body), "", tally(rows)].join("\n");
}

/** 两份结果按能力 id 对齐；只有状态变了的行才给出右边的证据 */
export function renderCompare(a: { title: string; rows: readonly Row[] }, b: { title: string; rows: readonly Row[] }): string {
  const byId = new Map(b.rows.map((r) => [r.capability.id, r]));
  const body = a.rows.map((ra) => {
    const rb = byId.get(ra.capability.id);
    if (!rb) return [ra.capability.name, ra.status, "（清单不一致）", ""];
    const changed = rb.status !== ra.status;
    return [ra.capability.name, ra.status, changed ? `→ ${rb.status}` : rb.status, changed ? citation(rb) : ""];
  });
  const changes = body.filter((r) => r[2]!.startsWith("→")).length;
  return [
    table(["能力", a.title, b.title, "变化的证据"], body),
    "",
    `${a.title}：${tally(a.rows)}`,
    `${b.title}：${tally(b.rows)}`,
    `${changes} 项状态不同`,
  ].join("\n");
}
