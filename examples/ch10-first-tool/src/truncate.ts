// 输出截断，照 pi 的 core/tools/truncate.ts 重写。两条上限各自独立，先碰到哪条算哪条（:1-9）：
//   - 行数上限 2000，字节上限 50KB（:11-12）
//   - 只交整行；truncateHead 碰到「第一行就超字节」时返回空内容，交给调用方换说法（:103-119）
//   - truncateTail 是唯一会交半行的地方：最后一行就超字节时，从行尾往前取，切在 UTF-8 字符边界上（:205-212、:247-262）

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface Truncation {
  readonly content: string;
  readonly truncated: boolean;
  readonly truncatedBy: "lines" | "bytes" | null;
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly outputLines: number;
  readonly outputBytes: number;
  readonly lastLinePartial: boolean;
  readonly firstLineExceedsLimit: boolean;
  readonly maxLines: number;
  readonly maxBytes: number;
}

export interface Limits {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/** 结尾的换行不算一行（:47-56） */
function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

const whole = (content: string, lines: number, size: number, maxLines: number, maxBytes: number): Truncation => ({
  content, truncated: false, truncatedBy: null, totalLines: lines, totalBytes: size,
  outputLines: lines, outputBytes: size, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes,
});

/** 留开头：适合读文件、搜索结果 */
export function truncateHead(content: string, limits: Limits = {}): Truncation {
  const maxLines = limits.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = splitLines(content);
  const base = { totalLines: lines.length, totalBytes: bytes(content), truncated: true, lastLinePartial: false, maxLines, maxBytes };
  if (lines.length <= maxLines && base.totalBytes <= maxBytes) return whole(content, lines.length, base.totalBytes, maxLines, maxBytes);
  if (bytes(lines[0]) > maxBytes) {
    return { ...base, content: "", truncatedBy: "bytes", outputLines: 0, outputBytes: 0, firstLineExceedsLimit: true };
  }
  let used = 0;
  let kept = 0;
  let by: "lines" | "bytes" = "lines";
  for (; kept < lines.length && kept < maxLines; kept++) {
    const cost = bytes(lines[kept]) + (kept > 0 ? 1 : 0); // +1 是换行
    if (used + cost > maxBytes) {
      by = "bytes";
      break;
    }
    used += cost;
  }
  const out = lines.slice(0, kept).join("\n");
  return { ...base, content: out, truncatedBy: by, outputLines: kept, outputBytes: bytes(out), firstLineExceedsLimit: false };
}

/** 从行尾往前取不超过 maxBytes 的字节，起点挪到字符边界上 */
function tailBytes(line: string, maxBytes: number): string {
  const buf = Buffer.from(line, "utf8");
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString("utf8");
}

/** 留结尾：适合命令输出，错误和结论通常在最后 */
export function truncateTail(content: string, limits: Limits = {}): Truncation {
  const maxLines = limits.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = splitLines(content);
  const base = { totalLines: lines.length, totalBytes: bytes(content), truncated: true, firstLineExceedsLimit: false, maxLines, maxBytes };
  if (lines.length <= maxLines && base.totalBytes <= maxBytes) return whole(content, lines.length, base.totalBytes, maxLines, maxBytes);
  let kept: string[] = [];
  let used = 0;
  let by: "lines" | "bytes" = "lines";
  let partial = false;
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const cost = bytes(lines[i]) + (kept.length > 0 ? 1 : 0);
    if (used + cost > maxBytes) {
      by = "bytes";
      if (kept.length === 0) {
        kept = [tailBytes(lines[i], maxBytes)];
        partial = true;
      }
      break;
    }
    kept = [lines[i], ...kept];
    used += cost;
  }
  const out = kept.join("\n");
  return { ...base, content: out, truncatedBy: by, outputLines: kept.length, outputBytes: bytes(out), lastLinePartial: partial };
}

/**
 * 截断之后给模型的那句话：看到了多少、少了多少、全文在哪。
 * 措辞照 pi 示例 examples/extensions/truncated-tool.ts:122-128；第一行就超限时换一种说法，空内容本身不说明任何事。
 */
export function truncationNotice(t: Truncation, fullOutputPath?: string): string {
  if (!t.truncated) return "";
  const where = fullOutputPath ? ` Full output saved to: ${fullOutputPath}` : "";
  if (t.firstLineExceedsLimit) {
    return `[First line alone is larger than the ${formatSize(t.maxBytes)} limit; nothing shown.${where}]`;
  }
  const omittedLines = t.totalLines - t.outputLines;
  const omittedBytes = t.totalBytes - t.outputBytes;
  return (
    `[Output truncated: showing ${t.outputLines} of ${t.totalLines} lines` +
    ` (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}).` +
    ` ${omittedLines} lines (${formatSize(omittedBytes)}) omitted.${where}]`
  );
}

export const MAX_LINE_CHARS = 500;

/** 单行太长就截到 maxChars 个字符，加上标记（照 truncate.ts:268-276，pi 的 grep 用它） */
export function truncateLine(line: string, maxChars = MAX_LINE_CHARS): { readonly text: string; readonly cut: boolean } {
  return line.length <= maxChars ? { text: line, cut: false } : { text: `${line.slice(0, maxChars)}... [truncated]`, cut: true };
}
