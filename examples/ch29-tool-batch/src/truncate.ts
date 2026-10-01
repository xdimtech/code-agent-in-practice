// 第 29 章：按 UTF-8 字节预算保留字符串尾部。对应 pi v2 的
// agent/src/harness/utils/truncate.ts:301-336。
//
// 不依赖 Buffer：从尾部逐个 UTF-16 码元往回走，代理对整体计 4 字节，
// 落单的代理项按它最终会变成的 U+FFFD 计 3 字节，绝不把一个代理对切成两半。

const REPLACEMENT = "�";

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** 把落单的代理项替换成 U+FFFD；成对的保持不变 */
export function replaceUnpairedSurrogates(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHigh(code) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      out += text[i] + text[i + 1];
      i++;
    } else {
      out += isHigh(code) || isLow(code) ? REPLACEMENT : text[i];
    }
  }
  return out;
}

/** 一个「字符」从 end 往前占多少码元、多少字节、是否落单 */
function charBefore(text: string, end: number): { units: number; bytes: number; lone: boolean } {
  const code = text.charCodeAt(end - 1);
  if (isLow(code) && end >= 2 && isHigh(text.charCodeAt(end - 2))) return { units: 2, bytes: 4, lone: false };
  if (isHigh(code) || isLow(code)) return { units: 1, bytes: 3, lone: true };
  return { units: 1, bytes: code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3, lone: false };
}

/** 保留尾部，结果的 UTF-8 长度不超过 maxBytes，且一定是合法的 Unicode 字符串 */
export function tailBytes(text: string, maxBytes: number): string {
  let start = text.length;
  let used = 0;
  let sawLone = false;
  while (start > 0) {
    const c = charBefore(text, start);
    if (used + c.bytes > maxBytes) break;
    used += c.bytes;
    start -= c.units;
    sawLone ||= c.lone;
  }
  const tail = text.slice(start);
  return sawLone ? replaceUnpairedSurrogates(tail) : tail;
}

export const utf8Length = (text: string): number => new TextEncoder().encode(text).length;
