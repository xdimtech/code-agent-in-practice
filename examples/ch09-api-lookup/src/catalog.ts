import { EVENT_NAMES, type EventName, type Merge, type Stage } from "./types.ts";

// 36 个事件的反查卡片。行号都相对 pi 基线 b79e4cc8 的 packages/coding-agent/src/（agent/ 开头的是 packages/agent/src/）。

export interface EventInfo {
  readonly name: EventName;
  readonly stage: Stage;
  readonly merge: Merge;
  /** 处理函数能改变什么；「只读」表示返回值被忽略 */
  readonly can: string;
  /** 在哪里触发 */
  readonly emittedAt: string;
}

const e = (name: EventName, stage: Stage, merge: Merge, can: string, emittedAt: string): EventInfo => ({ name, stage, merge, can, emittedAt });

export const EVENTS: readonly EventInfo[] = [
  e("project_trust", "startup", "first-decided", "决定是否信任项目目录（yes / no / undecided）", "core/project-trust.ts:55-59"),
  e("session_start", "startup", "notify", "只读；适合从会话分支重建状态", "core/agent-session.ts:2459"),
  e("resources_discover", "startup", "collect", "追加 skill / prompt / theme 路径", "core/agent-session.ts:2468"),
  e("input", "input", "transform", "改写用户输入，或 handled 吞掉它", "core/agent-session.ts:1187"),
  e("user_bash", "input", "first-result", "接管用户的 ! 命令：换执行方式或直接给结果", "modes/interactive/interactive-mode.ts:6463、modes/rpc/rpc-mode.ts:564"),
  e("before_agent_start", "run", "prompt", "追加一条 custom 消息；改这一次运行的 system prompt", "core/agent-session.ts:1278"),
  e("agent_start", "run", "notify", "只读", "core/agent-session.ts:773"),
  e("agent_end", "run", "notify", "只读", "core/agent-session.ts:775"),
  e("agent_settled", "run", "notify", "只读；重试和自动压缩都结束后才发", "core/agent-session.ts:633"),
  e("turn_start", "turn", "notify", "只读", "core/agent-session.ts:782"),
  e("turn_end", "turn", "notify", "只读", "core/agent-session.ts:790"),
  e("context", "request", "chain", "替换这一次 LLM 调用看到的消息数组（不落盘）", "core/sdk.ts:365"),
  e("before_provider_headers", "request", "in-place", "就地改 HTTP 头；赋 null 删除", "core/sdk.ts:338"),
  e("before_provider_request", "request", "chain", "替换发给 provider 的整个请求体", "core/sdk.ts:348"),
  e("after_provider_response", "request", "notify", "只读：状态码和响应头", "core/sdk.ts:355"),
  e("message_start", "message", "notify", "只读", "core/agent-session.ts:797"),
  e("message_update", "message", "notify", "只读；流式增量", "core/agent-session.ts:804"),
  e("message_end", "message", "same-role", "替换刚结束的消息（role 不能变）", "core/agent-session.ts:810"),
  e("tool_execution_start", "tool", "notify", "只读；比 tool_call 早，被拦的调用也有它", "agent/agent-loop.ts:443、:498"),
  e("tool_call", "tool", "block", "拦下调用；就地改 event.input 改参数", "core/agent-session.ts:495"),
  e("tool_execution_update", "tool", "notify", "只读；工具的流式进度", "core/agent-session.ts:840"),
  e("tool_result", "tool", "per-field", "改 content / details / isError / usage", "core/agent-session.ts:512"),
  e("tool_execution_end", "tool", "notify", "只读", "core/agent-session.ts:849"),
  e("session_info_changed", "session", "notify", "只读：会话名变了", "core/agent-session.ts:3086"),
  e("session_before_switch", "session", "cancel", "取消切换会话", "core/agent-session-runtime.ts:143"),
  e("session_before_fork", "session", "cancel", "取消 fork；或跳过对话恢复", "core/agent-session-runtime.ts:160"),
  e("session_before_compact", "session", "cancel", "取消压缩；或自己给出压缩结果", "core/agent-session.ts:1970、:2269"),
  e("session_compact", "session", "notify", "只读", "core/agent-session.ts:2038、:2363"),
  e("session_compact_failed", "session", "notify", "只读", "core/agent-session.ts:607"),
  e("session_before_tree", "session", "cancel", "取消跳转；或给出分支摘要、改摘要指令", "core/agent-session.ts:3164"),
  e("session_tree", "session", "notify", "只读；跳完分支后重建状态", "core/agent-session.ts:3283"),
  e("session_shutdown", "session", "notify", "只读；最后的清理机会", "core/agent-session-runtime.ts:172、:400，core/agent-session.ts:2814"),
  e("model_select", "model", "notify", "只读", "core/agent-session.ts:1644"),
  e("thinking_level_select", "model", "notify", "只读", "core/agent-session.ts:1810"),
  e("ui_prompt_start", "ui", "notify", "只读；在微任务里发，不等处理函数", "core/extensions/runner.ts:457、:483-485"),
  e("ui_prompt_end", "ui", "notify", "只读", "core/extensions/runner.ts:466"),
];

export const STAGE_TITLES: Readonly<Record<Stage, string>> = {
  startup: "启动",
  input: "输入",
  run: "一次运行",
  turn: "一轮",
  request: "发请求",
  message: "消息",
  tool: "工具",
  session: "会话",
  model: "模型",
  ui: "对话框",
};

/** 注册类 API：不是「发生了什么」，是「我要加点什么」。分组照 research/pi/07 §7.2 的 11 类 */
export interface ApiGroup {
  readonly group: string;
  readonly methods: readonly string[];
  readonly declaredAt: string;
  readonly when: string;
}

export const API_GROUPS: readonly ApiGroup[] = [
  { group: "订阅事件", methods: ["on"], declaredAt: "types.ts:1257-1301", when: "要对已经在发生的事做反应" },
  { group: "LLM 工具", methods: ["registerTool"], declaredAt: "types.ts:1308", when: "要模型能调用的新能力；加载后注册也立刻生效" },
  { group: "斜杠命令", methods: ["registerCommand"], declaredAt: "types.ts:1317", when: "要人主动触发；处理函数拿到的是 ExtensionCommandContext" },
  { group: "快捷键", methods: ["registerShortcut"], declaredAt: "types.ts:1320", when: "要在交互模式里一键触发；18 个保留键不能占" },
  { group: "命令行 flag", methods: ["registerFlag", "getFlag"], declaredAt: "types.ts:1329、:1345", when: "要启动时由人或脚本配置" },
  { group: "渲染", methods: ["registerMessageRenderer", "registerMarkdownTransformer", "registerEntryRenderer"], declaredAt: "types.ts:1352-1358", when: "要改变某类消息或条目在终端里的样子" },
  { group: "发消息与落盘", methods: ["sendMessage", "sendUserMessage", "appendEntry"], declaredAt: "types.ts:1365-1381", when: "要主动往会话里放东西：给模型看的、当作用户说的、只落盘不给模型的" },
  { group: "会话与工具集", methods: ["setSessionName", "getSessionName", "setLabel", "exec", "getActiveTools", "getAllTools", "setActiveTools", "getCommands"], declaredAt: "types.ts:1388-1409", when: "要读或改会话元数据、开关工具" },
  { group: "模型与思考级别", methods: ["setModel", "getThinkingLevel", "setThinkingLevel"], declaredAt: "types.ts:1416-1422", when: "要按任务切模型；没有 key 时 setModel 返回 false" },
  { group: "provider", methods: ["registerProvider", "unregisterProvider"], declaredAt: "types.ts:1480、:1496", when: "要接一个新的模型服务或改已有的（第 11 章）" },
  { group: "扩展间总线", methods: ["events"], declaredAt: "types.ts:1499", when: "要和另一个扩展通信" },
];

const BY_NAME: ReadonlyMap<string, EventInfo> = new Map(EVENTS.map((x) => [x.name, x]));

export const eventInfo = (name: string): EventInfo | undefined => BY_NAME.get(name);

export const isEventName = (name: string): name is EventName => (EVENT_NAMES as readonly string[]).includes(name);

export const eventsByStage = (stage: Stage): readonly EventInfo[] => EVENTS.filter((x) => x.stage === stage);

/** 能改变点什么的事件（返回值或就地修改会被宿主用上） */
export const canChange = (x: EventInfo): boolean => x.merge !== "notify";
