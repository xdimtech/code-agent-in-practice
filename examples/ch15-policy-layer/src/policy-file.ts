// 配置文件是外部输入：先当 unknown 校验，再变成 PolicyOverlay。
// 写错了就报错停下，不悄悄退回默认值——一份没生效的策略比没有策略更糟，因为你以为它在。

import type { Mode, PolicyOverlay } from "./types.ts";

export class PolicyFormatError extends Error {}

const MODES: readonly Mode[] = ["auto", "ask", "read-only"];
const KNOWN_KEYS = new Set(["mode", "writeRoots", "protectedPaths", "gateUserCommands"]);

function stringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v === "")) {
    throw new PolicyFormatError(`${key} 必须是非空字符串的数组`);
  }
  return value as readonly string[];
}

export function parseOverlay(value: unknown): PolicyOverlay {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PolicyFormatError("策略文件必须是一个 JSON 对象");
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
  // 拼错的键如果被忽略，用户会以为那条限制在生效
  if (unknown.length > 0) throw new PolicyFormatError(`不认识的键：${unknown.join("、")}`);
  if (raw.mode !== undefined && !MODES.includes(raw.mode as Mode)) throw new PolicyFormatError(`mode 只能是 ${MODES.join(" / ")}`);
  if (raw.gateUserCommands !== undefined && typeof raw.gateUserCommands !== "boolean") throw new PolicyFormatError("gateUserCommands 必须是布尔值");
  return {
    ...(raw.mode !== undefined && { mode: raw.mode as Mode }),
    ...(raw.writeRoots !== undefined && { writeRoots: stringArray(raw.writeRoots, "writeRoots") }),
    ...(raw.protectedPaths !== undefined && { protectedPaths: stringArray(raw.protectedPaths, "protectedPaths") }),
    ...(raw.gateUserCommands !== undefined && { gateUserCommands: raw.gateUserCommands }),
  };
}

export function parseOverlayText(text: string, label: string): PolicyOverlay {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PolicyFormatError(`${label} 不是合法的 JSON`);
  }
  try {
    return parseOverlay(value);
  } catch (error) {
    if (error instanceof PolicyFormatError) throw new PolicyFormatError(`${label}：${error.message}`);
    throw error;
  }
}
