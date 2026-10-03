// 「我想做 X」→ 用哪个事件或 API。每条带一个坑和一个 pi 自带示例（相对 packages/coding-agent/examples/extensions/）。

export interface Task {
  readonly id: string;
  readonly want: string;
  /** 首选；第一个就是答案 */
  readonly use: readonly string[];
  /** 看起来也行、其实不对的那个 */
  readonly notThis?: string;
  readonly pitfall: string;
  readonly example: string;
  /** 搜索用的额外关键词 */
  readonly keywords: readonly string[];
}

export const TASKS: readonly Task[] = [
  {
    id: "rewrite-input",
    want: "改写或吞掉用户敲进来的话",
    use: ["input"],
    notThis: "before_agent_start（那时模板已经展开，且不能阻止这次运行）",
    pitfall: "sendUserMessage 发出的话也会进 input（source=extension）；不判 source 就可能自己改自己",
    example: "input-transform.ts:15-42",
    keywords: ["输入", "前缀", "拦截", "prompt"],
  },
  {
    id: "user-bash",
    want: "接管用户的 ! 命令（换到远端或沙箱里跑）",
    use: ["user_bash"],
    notThis: "tool_call（那只管模型调用的 bash）",
    pitfall: "第一个返回非空结果的处理函数胜出，后面的扩展看不到；处理函数抛错会被吞掉、命令照常在本机执行",
    example: "ssh.ts:203",
    keywords: ["!", "bash", "ssh", "远端", "沙箱"],
  },
  {
    id: "system-prompt",
    want: "按状态改 system prompt",
    use: ["before_agent_start"],
    notThis: "context（它改的是消息数组，不是 system prompt）",
    pitfall: "多个扩展串联：用 event.systemPrompt 拼接，别从头写；只对这一次运行生效，下次运行重置为基础 prompt",
    example: "pirate.ts:28-46",
    keywords: ["系统提示", "人设", "规则"],
  },
  {
    id: "inject-context",
    want: "每次运行前塞一段额外上下文给模型",
    use: ["before_agent_start", "sendMessage({ deliverAs: \"nextTurn\" })"],
    notThis: "appendEntry（落盘但不进 LLM 上下文）",
    pitfall: "返回的 message 会作为 custom 消息落进会话；不想让它在之后的轮次里继续出现，要配合 context 过滤掉",
    example: "plan-mode/index.ts:201-215",
    keywords: ["注入", "上下文", "custom"],
  },
  {
    id: "filter-context",
    want: "只改这一次发给模型的消息，不改会话记录",
    use: ["context"],
    notThis: "message_end（那会改会话记录本身）",
    pitfall: "拿到的是 structuredClone 过的副本，就地改也无妨；但每轮都触发，别在里面做重活",
    example: "plan-mode/index.ts:177-198",
    keywords: ["过滤", "裁剪", "消息"],
  },
  {
    id: "rewrite-payload",
    want: "改发给 provider 的请求体（温度、缓存标记、脱敏）",
    use: ["before_provider_request"],
    notThis: "context（它在转换成 provider 格式之前）",
    pitfall: "fail-open：处理函数抛错，这一份改写丢失、请求照发；做脱敏要自己兜底（第 8 章 §8.3）",
    example: "provider-payload.ts:6-12",
    keywords: ["payload", "请求体", "脱敏", "温度"],
  },
  {
    id: "headers",
    want: "加或删 HTTP 头",
    use: ["before_provider_headers"],
    pitfall: "就地改 event.headers，返回值被忽略；删除要赋 null",
    example: "（pi 没有自带示例；见 docs/extensions.md 的 before_provider_headers 一节）",
    keywords: ["header", "头", "代理"],
  },
  {
    id: "block-tool",
    want: "拦下某些工具调用（危险命令、受保护路径）",
    use: ["tool_call"],
    notThis: "tool_execution_start（只读，而且比 tool_call 早）",
    pitfall: "唯一 fail-closed 的事件：处理函数抛错等于拦下；第一个 block 短路，后面的扩展看不到这次调用",
    example: "protected-paths.ts:13-29",
    keywords: ["拦截", "权限", "block", "危险"],
  },
  {
    id: "rewrite-args",
    want: "改模型给的工具参数",
    use: ["tool_call（就地改 event.input）"],
    pitfall: "没有「返回新参数」这条路，只能就地改；改完不会再校验一次 schema",
    example: "（pi 没有自带示例；见 docs/extensions.md 的 tool_call 一节）",
    keywords: ["参数", "input", "args"],
  },
  {
    id: "rewrite-result",
    want: "改工具结果（截断、脱敏、追加提示）",
    use: ["tool_result"],
    pitfall: "被 tool_call 拦下的调用没有 tool_result；逐字段串联，只返回想改的字段",
    example: "（见第 25 章 examples/ch25-audit-log/extension/audit-log.ts）",
    keywords: ["结果", "截断", "脱敏"],
  },
  {
    id: "rewrite-message",
    want: "改一条已经结束的消息再落盘",
    use: ["message_end"],
    pitfall: "返回的消息 role 必须和原来一样，否则被拒（记一条错误、保留原消息）",
    example: "（pi 没有自带的 message_end 处理函数示例；subagent/index.ts:362 是在子进程输出里读这个事件）",
    keywords: ["消息", "落盘", "改写"],
  },
  {
    id: "persist-state",
    want: "扩展自己的状态跟着会话走（换分支、恢复会话都对得上）",
    use: ["registerTool 的 execute 返回 details", "appendEntry", "session_start + session_tree 里从 getBranch() 重建"],
    notThis: "写到外部文件（分支切走后对不上）",
    pitfall: "只在 session_start 重建不够：/tree 跳分支不会再发 session_start，要同时订阅 session_tree",
    example: "todo.ts:114-133、tools.ts:39-60",
    keywords: ["状态", "持久化", "分支", "恢复"],
  },
  {
    id: "add-tool",
    want: "给模型一个新工具",
    use: ["registerTool", "setActiveTools"],
    pitfall: "加载后注册也立刻生效；名字和内置工具相同就是覆盖内置工具（第 10 章）",
    example: "todo.ts:136、dynamic-tools.ts",
    keywords: ["工具", "tool", "注册"],
  },
  {
    id: "toggle-tools",
    want: "按模式开关一批工具（只读模式、计划模式）",
    use: ["setActiveTools", "getActiveTools"],
    pitfall: "开关状态不会自动落盘；要配合 appendEntry 并在 session_start 里恢复",
    example: "plan-mode/index.ts:108-117、tools.ts:27-36",
    keywords: ["开关", "只读", "计划"],
  },
  {
    id: "command",
    want: "加一个斜杠命令",
    use: ["registerCommand"],
    notThis: "input 里自己匹配 /xxx（命令在 input 之前就被分发掉了）",
    pitfall: "命令处理函数拿到 ExtensionCommandContext，能 newSession / fork / reload；事件处理函数拿不到这些",
    example: "pirate.ts:19-25",
    keywords: ["命令", "/", "slash"],
  },
  {
    id: "flag",
    want: "让启动参数控制扩展行为",
    use: ["registerFlag", "getFlag"],
    pitfall: "在工厂函数里 getFlag 只拿得到默认值：命令行给的值要等所有扩展加载完才写进去（core/agent-session-services.ts:100-111），到 session_start 再读",
    example: "plan-mode/index.ts:53、:340-341",
    keywords: ["参数", "flag", "启动"],
  },
  {
    id: "shortcut",
    want: "绑一个快捷键",
    use: ["registerShortcut"],
    pitfall: "18 个保留键不能占（第 8 章）；只在交互模式下有意义",
    example: "preset.ts、plan-mode/index.ts",
    keywords: ["快捷键", "按键"],
  },
  {
    id: "send-user",
    want: "替用户发一句话，让 agent 跑起来",
    use: ["sendUserMessage"],
    notThis: "sendMessage（那是 custom 消息，默认不触发运行）",
    pitfall: "正在运行时不给 deliverAs 就失败，但调用处看不到异常：错误被记成扩展错误 send_user_message（core/agent-session.ts:1211-1215、:2577-2584）；它也会经过 input 事件（source=extension）",
    example: "send-user-message.ts",
    keywords: ["发消息", "触发", "自动"],
  },
  {
    id: "custom-compaction",
    want: "自己做压缩摘要",
    use: ["session_before_compact"],
    pitfall: "返回 { compaction } 就替换内置摘要，返回 { cancel: true } 就取消这次压缩；多个扩展时第一个 cancel 短路，否则最后一个结果胜出",
    example: "custom-compaction.ts:21",
    keywords: ["压缩", "摘要", "compact"],
  },
  {
    id: "guard-switch",
    want: "在切会话或 fork 之前拦一下（比如有未提交改动）",
    use: ["session_before_switch", "session_before_fork"],
    pitfall: "第一个 cancel 短路；会话替换后，之前捕获的 pi / ctx 都已失效（docs/extensions.md:1260-1302）",
    example: "dirty-repo-guard.ts:48-55",
    keywords: ["切换", "fork", "未提交", "保护"],
  },
  {
    id: "resources",
    want: "从扩展里带出 skill / prompt / theme",
    use: ["resources_discover"],
    pitfall: "所有扩展的路径都收集起来，不会互相覆盖；在 session_start 之后发",
    example: "dynamic-resources/index.ts:8-14",
    keywords: ["skill", "prompt", "theme", "资源"],
  },
  {
    id: "trust",
    want: "替用户决定项目目录是否可信",
    use: ["project_trust"],
    pitfall: "只有全局和命令行加载的扩展会收到；处理函数必须返回 { trusted }，返回 undefined 会在宿主里抛 TypeError（被当成错误记下）",
    example: "project-trust.ts:26",
    keywords: ["信任", "trust", "项目"],
  },
  {
    id: "provider",
    want: "接一个新的模型服务",
    use: ["registerProvider"],
    pitfall: "加载期间排队，加载完后立即生效（第 11 章）",
    example: "custom-provider-anthropic/index.ts",
    keywords: ["provider", "模型服务", "接入"],
  },
  {
    id: "status",
    want: "在界面上显示进度或状态",
    use: ["turn_start / turn_end + ctx.ui.setStatus"],
    pitfall: "非交互形态下 ui 是空实现，先看 ctx.hasUI（第 3 章）",
    example: "status-line.ts:13-30",
    keywords: ["状态栏", "进度", "界面", "ui"],
  },
  {
    id: "after-run",
    want: "一次运行彻底结束后做点事（提交、通知）",
    use: ["agent_settled"],
    notThis: "agent_end（之后可能还有自动重试和自动压缩）",
    pitfall: "agent_end 里排进队列的消息会让 agent 继续跑，agent_settled 才是真的停了",
    example: "git-checkpoint.ts:49",
    keywords: ["结束", "完成", "通知", "提交"],
  },
];

/** 按关键词找任务：want、关键词、事件名都参与匹配，大小写不敏感 */
export function findTasks(query: string): readonly Task[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return TASKS.filter((t) => [t.id, t.want, ...t.use, ...t.keywords].some((s) => s.toLowerCase().includes(q)));
}
