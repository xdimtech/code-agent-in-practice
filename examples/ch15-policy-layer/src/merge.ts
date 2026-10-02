// 分层配置的两种合并方式。
//   replaceMerge —— 后来的盖掉前面的。pi 的 sandbox 示例就是这么合并项目配置的
//                   （examples/extensions/sandbox/index.ts:105-130）：项目文件写 denyRead: [] 就把默认的 ~/.ssh 拿掉了。
//   tighten      —— 后来的只能让策略更紧。项目文件是仓库的一部分，clone 下来就在那儿，
//                   它能提出更严的要求，但不能替用户把限制放开。

import { resolve } from "node:path";
import { inside } from "./paths.ts";
import type { Mode, Policy, PolicyOverlay } from "./types.ts";

const STRICTNESS: Readonly<Record<Mode, number>> = { auto: 0, ask: 1, "read-only": 2 };

export const replaceMerge = (base: Policy, overlay: PolicyOverlay): Policy => ({ ...base, ...overlay });

export interface Tightened {
  readonly policy: Policy;
  /** 被忽略的放松请求，原样报给用户 */
  readonly ignored: readonly string[];
}

const within = (roots: readonly string[], candidate: string, cwd: string): boolean =>
  !candidate.startsWith("~") && roots.some((root) => inside(resolve(cwd, root), resolve(cwd, candidate)));

function tightenRoots(base: readonly string[], overlay: readonly string[] | undefined, cwd: string): { roots: readonly string[]; ignored: string[] } {
  if (overlay === undefined) return { roots: base, ignored: [] };
  const kept = overlay.filter((root) => within(base, root, cwd));
  const ignored = overlay.filter((root) => !within(base, root, cwd)).map((root) => `writeRoots 想加 ${root}，不在原来的可写范围里`);
  // 写了 [] 是明说「哪也不许写」，照办；写了一串却全在范围外，是想放宽，保留原范围并报出来
  return { roots: kept.length > 0 || overlay.length === 0 ? kept : base, ignored };
}

export function tighten(base: Policy, overlay: PolicyOverlay, cwd: string): Tightened {
  const ignored: string[] = [];
  const wantsLooserMode = overlay.mode !== undefined && STRICTNESS[overlay.mode] < STRICTNESS[base.mode];
  if (wantsLooserMode) ignored.push(`mode 想从 ${base.mode} 放到 ${overlay.mode}`);
  if (overlay.gateUserCommands === false && base.gateUserCommands) ignored.push("gateUserCommands 想关掉");
  const roots = tightenRoots(base.writeRoots, overlay.writeRoots, cwd);
  return {
    policy: {
      mode: overlay.mode === undefined || wantsLooserMode ? base.mode : overlay.mode,
      writeRoots: roots.roots,
      // 保护名单取并集：overlay 里少写一项不等于删掉它
      protectedPaths: [...new Set([...base.protectedPaths, ...(overlay.protectedPaths ?? [])])],
      gateUserCommands: base.gateUserCommands || overlay.gateUserCommands === true,
    },
    ignored: [...ignored, ...roots.ignored],
  };
}
