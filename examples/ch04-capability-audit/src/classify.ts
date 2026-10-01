// 本章的核心判断写成一个纯函数：给三组探针的命中结果，回答这项能力处在哪种状态。

import type { Capability, Probe } from "./manifest.ts";

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export type Status = "有" | "未接线" | "声明过时" | "决定不做" | "没做";

export interface Evidence {
  readonly present: readonly Hit[];
  /** 清单没有给 wired 探针时为 undefined——不检查接线 */
  readonly wired: readonly Hit[] | undefined;
  readonly declared: readonly Hit[];
}

export interface Row {
  readonly capability: Capability;
  readonly status: Status;
  readonly evidence: Evidence;
}

/**
 * 判断顺序就是正文 4.2 节的三个问题：
 *   代码里有没有实现？ → 有的话，有没有调用点？文档是不是还说不做？
 *   没有实现的话，有没有书面声明？
 */
export function classify(e: Evidence): Status {
  if (e.present.length > 0) {
    if (e.declared.length > 0) return "声明过时";
    if (e.wired !== undefined && e.wired.length === 0) return "未接线";
    return "有";
  }
  return e.declared.length > 0 ? "决定不做" : "没做";
}

export type Grep = (probe: Probe) => readonly Hit[];

/** 探针按顺序试，第一个有（保留下来的）命中的就是证据——清单里把最具体的探针写在前面 */
function hitsOf(probes: readonly Probe[], grep: Grep, keep: (h: Hit) => boolean = () => true): readonly Hit[] {
  for (const probe of probes) {
    const hits = grep(probe).filter(keep);
    if (hits.length > 0) return hits;
  }
  return [];
}

const sameLine = (a: Hit) => (b: Hit) => a.file === b.file && a.line === b.line;

/** 对一份清单逐项取证、归类。grep 由调用方注入，测试时可以不碰 git */
export function audit(caps: readonly Capability[], grep: Grep): Row[] {
  return caps.map((capability) => {
    const present = hitsOf(capability.present, grep);
    // 定义处本身不算调用点：`export function f(` 也能被 `f\(` 命中
    const isCallSite = (h: Hit) => !present.some(sameLine(h));
    const evidence: Evidence = {
      present,
      wired: capability.wired && hitsOf(capability.wired, grep, isCallSite),
      declared: hitsOf(capability.declared ?? [], grep),
    };
    return { capability, status: classify(evidence), evidence };
  });
}
