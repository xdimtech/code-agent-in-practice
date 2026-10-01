// pi 的能力清单：正文 4.1 节那张表的 24 行，每行配上「怎么在代码里取证」。
// 路径是 glob pathspec，写成 `**/coding-agent/src/**` 而不是 `packages/coding-agent/src/**`，
// 是为了让同一份清单也能跑在把 pi 放进子目录的 fork 上（例如 minimax-code 的 third_party/pi-mono/）。

import type { Capability, Probe } from "./manifest.ts";

const SRC = ["**/src/**"];
const PRODUCT = ["**/coding-agent/src/**"];
const TOOLS = ["**/coding-agent/src/core/tools/**"];
const DOCS = ["**/coding-agent/README.md", "**/coding-agent/docs/**"];

const inSrc = (pattern: string, ignoreCase = false): Probe => ({ pattern, paths: SRC, ignoreCase });
const inProduct = (pattern: string, ignoreCase = false): Probe => ({ pattern, paths: PRODUCT, ignoreCase });
const inDocs = (pattern: string): Probe => ({ pattern, paths: DOCS });

export const PI_MANIFEST: readonly Capability[] = [
  // —— 做了的 ——
  { id: "tui", name: "交互式 TUI", present: [inSrc("class TuiMainScreen")] },
  { id: "modes", name: "print / JSON / RPC / SDK", present: [inProduct('export type Mode = "text"')] },
  { id: "session", name: "会话持久化（JSONL）", present: [inProduct('endsWith\\("\\.jsonl"\\)')] },
  { id: "compaction", name: "上下文压缩", present: [inProduct("export function shouldCompact")] },
  { id: "agents-md", name: "AGENTS.md / CLAUDE.md", present: [inProduct('"AGENTS\\.md"')] },
  { id: "skills", name: "Skills", present: [inProduct("SKILL\\.md")] },
  { id: "tools", name: "内置工具（默认开 4 个）", present: [inProduct('\\["read", "bash", "edit", "write"\\]')] },
  { id: "extensions", name: "扩展系统", present: [inProduct("export interface ExtensionAPI")] },
  { id: "provider-registry", name: "Provider 运行时注册", present: [inProduct("registerProvider\\(")] },
  { id: "packages", name: "包分发", present: [inProduct("class DefaultPackageManager")] },
  { id: "themes", name: "主题", present: [inProduct("getThemesDir")] },

  // —— 写下来不做的 ——
  {
    id: "permission",
    name: "工具执行前的权限确认",
    present: [inProduct("PermissionMode|requireApproval|permissionPolicy|approvalMode")],
    declared: [inDocs("No permission popups\\.")],
  },
  {
    id: "sandbox",
    name: "沙箱",
    present: [inSrc("sandbox-exec|bubblewrap|bwrap|seccomp|landlock")],
    declared: [inDocs("does not include a built-in sandbox")],
  },
  {
    id: "mcp",
    name: "MCP",
    present: [inSrc("@modelcontextprotocol|mcpServers|McpClient")],
    declared: [inDocs("No MCP\\.")],
  },
  {
    id: "subagent",
    name: "子 agent",
    present: [inProduct('name: "subagent"'), inSrc("sub-?agent", true)],
    declared: [inDocs("No sub-agents\\.")],
  },
  {
    id: "plan-mode",
    name: "Plan mode",
    present: [inProduct("planMode|PlanMode|plan_mode")],
    declared: [inDocs("No plan mode\\.")],
  },
  {
    id: "todo",
    name: "内置 to-do",
    // 先找工具注册（name: "task_create"），找不到再退到任何提到 todo 的地方
    present: [inProduct('name: "(task_create|task_list|todo_write|todo)"'), inProduct("todo", true)],
    declared: [inDocs("No built-in to-dos\\.")],
  },
  {
    id: "background-bash",
    name: "后台 bash",
    // 只看工具实现：子 agent 的 run_in_background 不是后台 bash
    present: [{ pattern: "run_in_background|runInBackground|background", paths: TOOLS, ignoreCase: true }],
    declared: [inDocs("No background bash\\.")],
  },

  // —— 没做、也没表态的 ——
  { id: "code-mode", name: "Code Mode", present: [inSrc("codeMode|code_mode|runCode|executeCode")] },
  { id: "memory", name: "跨会话记忆", present: [inSrc("MEMORY\\.md|memories|memoryStore|saveMemory")] },
  { id: "structured-log", name: "结构化日志", present: [inSrc("createLogger|LogLevel|pino|winston")] },
  { id: "replay", name: "provider 录制回放", present: [inSrc("PI_TRACE|PI_RECORD|PI_REPLAY|recordRequest")] },
  { id: "doctor", name: "自检命令（doctor）", present: [inSrc("doctor")] },

  // —— 契约在、没接线的 ——
  {
    id: "span-telemetry",
    name: "span 遥测",
    present: [inSrc("export function (startAiSpan|startHarnessSpan)")],
    // 调用可能带泛型参数：startAiSpan<"x">(…)
    wired: [inSrc("(startAiSpan|startHarnessSpan)[<(]")],
  },
];
