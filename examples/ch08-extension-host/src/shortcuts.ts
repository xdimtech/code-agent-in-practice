import type { Extension } from "./types.ts";

export interface Builtin {
  key: string;
  action: string;
  /** 保留键：扩展不能覆盖。pi 保留 18 个编辑器全局动作（runner.ts:72-91）。 */
  reserved: boolean;
}

export interface ShortcutOwner {
  path: string;
  description: string;
}

export interface ShortcutResolution {
  shortcuts: ReadonlyMap<string, ShortcutOwner>;
  warnings: readonly string[];
}

/**
 * 扩展快捷键与内置键冲突时的三条规则（pi：runner.ts:544-590）：
 * 撞上保留键 → 跳过；撞上非保留的内置键 → 扩展赢，给警告；两个扩展撞车 → 后加载的赢，给警告。
 * 这是扩展系统里少有的一条「宿主说了算」的边界。
 */
export function resolveShortcuts(builtins: readonly Builtin[], extensions: readonly Extension[]): ShortcutResolution {
  const builtinByKey = new Map(builtins.map((b) => [b.key.toLowerCase(), b]));
  let shortcuts = new Map<string, ShortcutOwner>();
  let warnings: string[] = [];
  const warn = (message: string) => {
    warnings = [...warnings, message];
  };

  for (const extension of extensions) {
    for (const { key, description } of extension.shortcuts) {
      const builtin = builtinByKey.get(key);
      if (builtin?.reserved) {
        warn(`${extension.path} 的「${key}」与保留键 ${builtin.action} 冲突，已跳过`);
        continue;
      }
      if (builtin) warn(`${extension.path} 覆盖了内置键「${key}」（${builtin.action}）`);
      const previous = shortcuts.get(key);
      if (previous) warn(`「${key}」同时被 ${previous.path} 和 ${extension.path} 注册，用后者`);
      shortcuts = new Map([...shortcuts, [key, { path: extension.path, description }]]);
    }
  }
  return { shortcuts, warnings };
}
