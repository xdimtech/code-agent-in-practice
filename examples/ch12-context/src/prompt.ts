import { formatSkillsForPrompt } from "./skills.ts";
import type { ContextFile, Skill } from "./types.ts";

export interface BuildOptions {
  /** 相当于 SYSTEM.md / --system-prompt：整段替换角色说明，但后面几段照拼。 */
  readonly customPrompt?: string;
  readonly selectedTools?: readonly string[];
  /** 只有给了一行说明的工具才出现在 Available tools 里。 */
  readonly toolSnippets?: Readonly<Record<string, string>>;
  readonly promptGuidelines?: readonly string[];
  /** 相当于 APPEND_SYSTEM.md / --append-system-prompt。 */
  readonly appendSystemPrompt?: string;
  readonly contextFiles?: readonly ContextFile[];
  readonly skills?: readonly Skill[];
  /** step-harness 的 promptAppendix 位置：技能之后、工作目录之前。pi 没有这一段。 */
  readonly appendix?: string;
  readonly cwd: string;
}

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"] as const;
const ALWAYS = ["Be concise in your responses", "Show file paths clearly when working with files"] as const;

/**
 * 拼装顺序照 pi 的 system-prompt.ts:28-169：
 * 角色（或 customPrompt）→ append → <project_context> → 技能清单 → [appendix] → 工作目录。
 * 纯函数：同样的输入永远得到同一个字符串，这是前缀缓存能命中的前提。
 */
export function buildSystemPrompt(options: BuildOptions): string {
  // 没给 selectedTools 就按默认四件套算，其中有 read——两个分支都这样（system-prompt.ts:64、:81）
  const tools = options.selectedTools ?? DEFAULT_TOOLS;
  const head = options.customPrompt ?? defaultHead(options, tools);
  const hasRead = tools.includes("read");
  return [
    head,
    options.appendSystemPrompt ? `\n\n${options.appendSystemPrompt}` : "",
    formatContextFiles(options.contextFiles ?? []),
    hasRead ? formatSkillsForPrompt(options.skills ?? []) : "",
    options.appendix ? `\n\n${options.appendix}` : "",
    `\nCurrent working directory: ${options.cwd.replace(/\\/g, "/")}`,
    // customPrompt 分支末尾多一个换行（system-prompt.ts:69），照抄，免得同样的输入拼出两种字节
    options.customPrompt ? "\n" : "",
  ].join("");
}

function defaultHead(options: BuildOptions, tools: readonly string[]): string {
  const visible = tools.filter((name) => Boolean(options.toolSnippets?.[name]));
  const toolsList = visible.length > 0 ? visible.map((name) => `- ${name}: ${options.toolSnippets?.[name]}`).join("\n") : "(none)";
  const guidelines = [...new Set([...explorationGuideline(tools), ...(options.promptGuidelines ?? []).map((g) => g.trim()).filter(Boolean), ...ALWAYS])];
  return [
    "You are an expert coding assistant. You help users by reading files, executing commands, editing code, and writing new files.",
    "",
    "Available tools:",
    toolsList,
    "",
    "Guidelines:",
    guidelines.map((g) => `- ${g}`).join("\n"),
  ].join("\n");
}

function explorationGuideline(tools: readonly string[]): readonly string[] {
  const searchable = ["grep", "find", "ls"].some((name) => tools.includes(name));
  return tools.includes("bash") && !searchable ? ["Use bash for file operations like ls, rg, find"] : [];
}

/** 整份文件原样放进去，没有截断、没有摘要（system-prompt.ts:151-159）。 */
export function formatContextFiles(files: readonly ContextFile[]): string {
  if (files.length === 0) return "";
  const blocks = files.map((file) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`);
  return `\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n${blocks.join("")}</project_context>\n`;
}
