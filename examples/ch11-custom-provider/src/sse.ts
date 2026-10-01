/**
 * 两个和具体厂商无关的流式小工具：SSE 切行、半截 JSON 尽力解析。
 * pi 分别交给 OpenAI SDK 和 partial-json 库；这里手写，好让你看清它们在处理什么。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function dataOf(line: string): string | undefined {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  return trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : undefined;
}

function parseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    throw new Error(`SSE 数据不是合法 JSON：${data.slice(0, 60)}`);
  }
}

/**
 * 网络分块和 SSE 行边界没有关系：一行可能被切成两块到达。所以先拼进缓冲区，只处理完整的行，
 * 剩下的半行留到下一块。`data: [DONE]` 是 OpenAI 约定的结束标记；不是 `data:` 开头的行（注释、event:）跳过。
 */
export async function* parseSSE(body: AsyncIterable<string>): AsyncIterable<unknown> {
  let buffer = "";
  for await (const chunk of body) {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = dataOf(line);
      if (data === "[DONE]") return;
      if (data) yield parseData(data);
    }
  }
  const tail = dataOf(buffer);
  if (tail && tail !== "[DONE]") yield parseData(tail);
}

/** 补齐没闭合的字符串和括号。只管结构，不管语义：`{"a":` 补完是 `{"a":}`，照样解析不了。 */
function closeJson(text: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }
  return (inString ? `${text}"` : text) + closers.reverse().join("");
}

/**
 * 工具调用的参数是一段一段流过来的 JSON。每来一段就尽力解析一次，好让 UI 早点显示「要读哪个文件」。
 * 依次尝试：原样、补齐括号、退回最后一个逗号再补齐。都失败就给空对象——此刻还拼不出东西不是错误，
 * 流结束时参数仍然不完整才是，那由上层决定怎么报。
 */
export function parsePartialJson(text: string): Record<string, unknown> {
  if (text.trim() === "") return {};
  const lastComma = text.lastIndexOf(",");
  const candidates = [text, closeJson(text), ...(lastComma > 0 ? [closeJson(text.slice(0, lastComma))] : [])];
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isRecord(value)) return value;
    } catch {
      // 这一种补法不行，换下一种
    }
  }
  return {};
}

export { isRecord };
