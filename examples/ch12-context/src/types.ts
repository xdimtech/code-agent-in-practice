/** 内存里的文件系统：绝对 POSIX 路径 → 文件内容。目录由路径前缀隐含。 */
export type Vfs = ReadonlyMap<string, string>;

export interface ContextFile {
  readonly path: string;
  readonly content: string;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly source: string;
  readonly disableModelInvocation: boolean;
}

export interface Diagnostic {
  readonly type: "warning" | "collision";
  readonly message: string;
  readonly path: string;
}

export interface LoadSkillsResult {
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  /** 扩展注入的消息带上来源标记，便于 context 钩子识别后过滤。 */
  readonly customType?: string;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
}

/** 一次模型请求里决定缓存命中的三段：工具、system、消息。 */
export interface Request {
  readonly tools: readonly ToolDef[];
  readonly system: string;
  readonly messages: readonly Message[];
}
