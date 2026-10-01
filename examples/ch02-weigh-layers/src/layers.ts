// 把文件归到「层」，再按层求和。归类是纯函数：同一份文件清单永远得到同一张表。

export interface SourceFile {
  readonly path: string;
  readonly lines: number;
}

/** 一层由若干路径前缀定义；前缀以 `/` 结尾表示目录，否则是单个文件 */
export interface Layer {
  readonly name: string;
  readonly prefixes: readonly string[];
}

/** 预设层都没命中的文件归到这里 */
export const REST = "其余";

export interface LayerTotal {
  readonly name: string;
  readonly lines: number;
  readonly files: number;
}

/** 按 layers 的顺序找第一个命中的层——所以更窄的层要排在更宽的层前面 */
export function classify(path: string, layers: readonly Layer[]): string | undefined {
  const hit = layers.find((layer) =>
    layer.prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p)),
  );
  return hit?.name;
}

/** 没有预设时的分组：`packages/ai/src/x.ts` → `packages/ai` */
export function autoLayerName(path: string): string {
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * 按层求和。给了 layers 就按预设归类，未命中的进「其余」；没给就按 autoLayerName 分组。
 * 预设层即使一行都没有也保留在结果里，方便两个仓库逐行对照。
 */
export function summarize(files: readonly SourceFile[], layers?: readonly Layer[]): LayerTotal[] {
  const order = layers ? [...layers.map((l) => l.name), REST] : [];
  const totals = new Map<string, { lines: number; files: number }>(
    order.map((name) => [name, { lines: 0, files: 0 }]),
  );
  for (const f of files) {
    const name = layers ? (classify(f.path, layers) ?? REST) : autoLayerName(f.path);
    const prev = totals.get(name) ?? { lines: 0, files: 0 };
    totals.set(name, { lines: prev.lines + f.lines, files: prev.files + 1 });
  }
  const rows = [...totals].map(([name, t]) => ({ name, ...t }));
  if (layers) return rows.filter((r) => r.name !== REST || r.files > 0);
  return rows.sort((a, b) => b.lines - a.lines);
}

export function grandTotal(rows: readonly LayerTotal[]): LayerTotal {
  return rows.reduce((acc, r) => ({ name: "合计", lines: acc.lines + r.lines, files: acc.files + r.files }), {
    name: "合计",
    lines: 0,
    files: 0,
  });
}
