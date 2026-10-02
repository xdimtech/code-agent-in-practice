// 策略层的全部词汇。机制（pi 的钩子）只负责在执行前问一句；问什么、怎么答，都在这里。

/** 谁发起的：模型产生的工具调用，还是用户亲手敲的 ! 命令 */
export type Origin = "model" | "user";

export type Verdict = "allow" | "ask" | "deny";

/** 由松到紧：auto 只问危险的，ask 写和执行都问，read-only 不许写也不许执行 */
export type Mode = "auto" | "ask" | "read-only";

export interface Request {
  readonly origin: Origin;
  readonly tool: string;
  readonly command?: string;
  readonly path?: string;
}

export interface Decision {
  readonly verdict: Verdict;
  /** 是哪条规则定的，写进拒绝理由和审计记录 */
  readonly rule: string;
  readonly reason: string;
}

export interface Policy {
  readonly mode: Mode;
  /** 写入必须落在这些目录里；相对路径相对工作区根 */
  readonly writeRoots: readonly string[];
  /** 即使在 writeRoots 里也不许写；按路径段和文件名匹配，不是子串 */
  readonly protectedPaths: readonly string[];
  /** 用户亲手敲的 ! 命令是否也过这套规则 */
  readonly gateUserCommands: boolean;
}

/** 配置文件里能写的部分；每个字段都可以不写 */
export type PolicyOverlay = Partial<Policy>;

export const DEFAULT_POLICY: Policy = {
  mode: "ask",
  writeRoots: ["."],
  protectedPaths: [".env", ".env.*", ".git", "*.pem", "*.key"],
  gateUserCommands: true,
};
