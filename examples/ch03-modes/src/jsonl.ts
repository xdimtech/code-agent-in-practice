import { StringDecoder } from "node:string_decoder";

// 严格 JSONL 分帧：只按 \n 切，去掉行尾一个 \r，其他字符一律当内容。
// pi 自己的实现在 `modes/rpc/jsonl.ts:21-58`；这里多了一道单行上限（Step-Code 的子 agent 用 2 MB）。

export const MAX_LINE_BYTES = 2 * 1024 * 1024;

export function serializeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const stripCr = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);

export interface Framed {
  readonly lines: readonly string[];
  /** 还没等到 \n 的半行，留给下一块 */
  readonly rest: string;
}

/** 纯函数版：把已收到的文本切成完整的行和剩下的半行 */
export function takeLines(buffer: string): Framed {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map(stripCr), rest };
}

/** 整份文本一次切完（末尾没有 \n 的最后一行也算一行），用来检查录下来的输出 */
export function splitStrict(text: string): readonly string[] {
  const { lines, rest } = takeLines(text);
  return rest.length > 0 ? [...lines, stripCr(rest)] : lines;
}

/**
 * 通用分行器的切法：\r\n、\n、\r、U+2028、U+2029 都算换行。
 * Node 24 起的 readline 就是这样切的（本书在 v24.14.1、v25.8.2 上实测；v16 / v18 / v22 只认 \r 和 \n）。
 */
const GENERIC = /\r\n|\n|\r|\u2028|\u2029/;

export function splitGeneric(text: string): readonly string[] {
  const parts = text.split(GENERIC);
  return parts.at(-1) === "" ? parts.slice(0, -1) : parts;
}

/** 流式的通用切法，只用来演示它在哪里切错 */
export function takeLinesGeneric(buffer: string): Framed {
  const parts = buffer.split(GENERIC);
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

export type Splitter = (buffer: string) => Framed;

export interface LineReader {
  push(chunk: Buffer | string): void;
  end(): void;
}

export interface ReaderHooks {
  readonly onLine: (line: string) => void;
  /** 半行攒到上限还没等到 \n：调用方应该当协议错误处理（杀掉子进程） */
  readonly onOversize: (bytes: number) => void;
}

/** 流式版：字节块可能把一个多字节字符切成两半，所以用 StringDecoder 拼 */
export function createLineReader(hooks: ReaderHooks, maxBytes = MAX_LINE_BYTES, split: Splitter = takeLines): LineReader {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let dead = false;
  const feed = (text: string) => {
    if (dead) return;
    const { lines, rest } = split(buffer + text);
    for (const line of lines) hooks.onLine(line);
    buffer = rest;
    const bytes = Buffer.byteLength(buffer, "utf8");
    if (bytes > maxBytes) {
      dead = true;
      hooks.onOversize(bytes);
    }
  };
  return {
    push: (chunk) => feed(typeof chunk === "string" ? chunk : decoder.write(chunk)),
    end() {
      feed(decoder.end());
      if (!dead && buffer.length > 0) hooks.onLine(stripCr(buffer));
      buffer = "";
    },
  };
}
