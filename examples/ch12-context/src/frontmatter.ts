export type FrontmatterValue = string | boolean;

export interface Parsed {
  readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
}

const FENCE = "---";

/**
 * 只认 `key: value` 一行一对的最小 YAML 子集，够 SKILL.md 用。
 * pi 用的是完整 YAML 解析器（utils/frontmatter.ts）；这里不支持嵌套和多行值，遇到就报错，不猜。
 */
export function parseFrontmatter(text: string): Parsed {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== FENCE) return { frontmatter: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (end === -1) throw new Error("frontmatter 没有结束的 ---");
  const entries = lines.slice(1, end).filter((line) => line.trim() !== "").map(parseLine);
  return { frontmatter: Object.fromEntries(entries), body: lines.slice(end + 1).join("\n") };
}

function parseLine(line: string): [string, FrontmatterValue] {
  const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
  if (!match) throw new Error(`无法解析的 frontmatter 行：${line.slice(0, 40)}`);
  const [, key, raw] = match as unknown as [string, string, string];
  return [key, parseScalar(raw.trim())];
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const quoted = /^(["'])(.*)\1$/.exec(raw);
  return quoted ? (quoted[2] ?? "") : raw;
}
