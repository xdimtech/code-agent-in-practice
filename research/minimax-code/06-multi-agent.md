# 6. 多 Agent 与任务

> 对照基准：[pi 第 6 章](../pi/06-multi-agent.md)。pi 的立场是「No sub-agents」，需要就自己用扩展或 tmux 起一个；minimax-code 有一个 `task` 工具、三个内置角色、一个通用代理、一套前后台共用的任务状态机，外加一个 codex 风格的长任务目标 `/goal`。

## 6.1 角色与入口

### 三个角色加一个通用代理

【代码事实】`shared/src/subagent-roles.ts`：

| 目标 | 定位（`whenToUse` 原文摘要） | 位置 |
| --- | --- | --- |
| `explore` | 只读摸底；「can use Bash for read-only Git and code investigation, but cannot create or edit files」 | `:8-12` |
| `worker` | 「Bounded production work with explicit scope, ownership, deliverable, and acceptance」 | `:13-16` |
| `verifier` | 独立验证，「no project-file changes」 | `:17-21` |
| `mavis` | 「Broad or mixed-scope work」 | `:26,31` |

`TASK_AGENT_TARGETS = ['mavis', ...roles]`（`:26`）。三个角色名和 `mavis` 是保留名（`:38-42`）；用户自建的 agent 撞名时被改成 `agent:<name>`（`:56-69`），只有来源标记是内置（`3` 或 `'builtin'`）的才被当作「可信内置」（`isTrustedBuiltinCreationSource`，`:52-54`）。

【推断】改名而不是拒绝，是为了让用户的同名 agent 仍可用，同时不让它冒充内置角色拿到内置角色的待遇（6.3 的只读文件系统、verifier 的角色标记都只给可信内置）。

### `task` 的契约写在描述里

【代码事实】`agent-tools/src/desktop/builtin-defs.ts:514-552` 的 `LOCAL_TASK_TOOL_DESCRIPTION` 有几句是规则而不是说明：

- 「delegation grants no additional permission」——委派不提权；
- 「Parallel writers must own disjoint files; otherwise use one writer serially」；
- 「The child has no parent conversation history. Provide a self-contained prompt」；
- 「Foreground is the default and waits」，要并行就 `run_in_background`。

参数（`:554-593`）：`description`、`prompt`、`agent_name`，可选 `model` / `effort`（描述写「Set only when the user explicitly specifies…」）、`run_in_background`。`prepareTaskArguments()`（`:595-604`）把空白的 `model` / `effort` 删掉，避免模型填一个空串覆盖默认。

### 前台委派是串行的

【代码事实】`task` 的 `executionMode: 'sequential'`（`builtin-defs.ts:606-612`）。vendor 的 L1 循环里，一批 tool call 只要有一个是 `sequential`，整批都走串行（`third_party/pi-mono/packages/agent/src/agent-loop.ts:385-390`）。

【推断】模型在一条消息里发三个前台 `task`，它们会一个接一个跑，同一批里的 `read`、`grep` 也跟着串行。真正的并行只有 `run_in_background` 一条路。这和「parallel writers must own disjoint files」那句提示配合：默认就不会有两个前台写者同时动手。

## 6.2 子会话

【代码事实】`local-runtime/src/api/local-task-runner.ts`（196 行）的 `runForegroundLocalTask()`（`:39-155`）：

1. 即使是前台，也先建一条后台任务记录（`:66-68` 注释：「A foreground run uses the same task state machine as a background one」）；
2. 建子会话（`:84-97`）：`sessionType: 'branch'`、`sessionKind: 'task'`、`parentSessionId`、`visibility: 'hidden'`、`workspaceDir: parent.workspaceDir`；
3. 触发插件的 subagent 生命周期 hook（`:106-118`）；
4. 可信内置的 verifier 打上 `agentRole: 'verifier'`（`:128-130`）；
5. 结束时 `finalizeForegroundTask()`（`:163-196`）把投递状态锁成 `already-delivered`，前台结果已经作为工具结果回来了，不再发一次「任务完成」唤醒。

### 没有 worktree 隔离

【代码事实】子会话的 `workspaceDir` 直接取父会话的。仓库里有 worktree 代码：`local-runtime-v2/src/service/workspace/operations/worktrees.ts` 只做列举；`local-runtime-v2/src/infra/git/fork-worktree-adapter.ts`（846 行，`OwnedWorktree` 带 `ownershipToken` / `preparedFingerprint`）接在 `background-runtime.ts:5`，服务的是**会话 fork**，不是 task 子会话。

【推断】两个后台 worker 写同一个仓库时，靠的只是描述里那句「disjoint files」。

### 子 agent 的合同

【代码事实】`local-runtime-v2/assets/agents/_v2/AGENT_CONTEXT.md.hbs:181-215` 的 `## Delegated Task Contract`（TUI 与非 TUI 两个版本）：

- 「You are a hidden child Agent…」
- 「Do not delegate…」
- 「Do not ask the end user questions」，遇到阻塞就「return the exact blocker and the smallest question」；
- 「Write only the current executing Agent's own Agent Memory」；
- 「never claim checks you did not run」。

自定义 agent 的提示里没有这一段时，`catalog.ts:320-329` 的 `ensureDelegatedTaskContract()` 会补上。【推断】合同不依赖每个 agent 作者记得写，宿主保证它在。

### 深度是 1

【代码事实】`local-turn-tool-catalog.ts`：

- `:280-285`：`task`、`task_append`，以及非内置的任务控制工具，只给 `isAuthoritativeMainProfile`；
- `:308`：`surface === 'task-child'` 去掉 `TASK_CHILD_BLOCKED_TOOL_NAMES`（`task`、`task_append`、`todowrite`、`ask_user`，`:452-454`）；
- `:311`：内置角色的子任务再去掉 `mavis`。

子 agent 不能再委派，也拿不到 `mavis`（后者能给别的会话发消息、建 cron）。递归在工具层面就断了，合同里那句「Do not delegate」是第二道。

## 6.3 工具上限

【代码事实】`agent-tools/src/desktop/canonical-tool-policy.ts`（79 行）：

| 角色 | 去掉的工具 | 位置 |
| --- | --- | --- |
| `worker` | 只去委派（`task`、`task_append`） | `:10,33-51` |
| `explore` | `write`、`edit`、`website_deploy`、`todowrite`、`task`、`task_append`、`memory`、`ask_user`、`request_feature_enable`、所有 `desktop_*`；再加 `task_query` / `task_output` / `task_stop` | `:11-21,33-51` |
| `verifier` | 同 explore，但保留任务查询三件套 | 同上 |

内置 MCP 也按角色筛：explore 和 verifier 只留联网搜索（`filterCanonicalBuiltinMcpEntries`，`:58-73`）。

**`bash` 三个角色都留着。**

### explore 的「只读」靠沙箱

【代码事实】只读文件系统的标记在这里产生：`local-turn-execution-preparation.ts:257-258`，

```ts
forceReadOnlyFilesystem = identity.trustedBuiltin && canonicalViewName === 'explore'
```

它往下传到 `local-pi-tools.ts:549` 和 `local-runtime/src/background-task/bash-runner.ts:347`，最终**只**被 `local-runtime-v2/src/service/sandbox/local-sandbox-service.ts:343-349` 的 `#invocationPolicy()` 读取，转成 `withReadOnlyFilesystem`；这一步只在走沙箱的路径上执行（`:385`）。沙箱关闭时（默认，第 5 章 5.5），`#admitInvocation()`（`:362-377`）直接返回原生执行租约，不套任何策略。权限模块里没有读这个标记的代码。

【推断】默认配置下，explore 的 `bash` 能写文件：`echo x > a.txt`、`sed -i` 都会照常执行，权限层按普通命令判（auto 模式下可能被分类器放行）。「只读」由三样东西撑着：删掉 `write` / `edit`、角色描述、沙箱——前两样是对模型的约束，只有第三样是机制，而它默认不在。verifier 连 `forceReadOnlyFilesystem` 都没有（条件只认 `explore`），「no project-file changes」完全靠提示。

## 6.4 任务状态机：前后台共用

【代码事实】`agent-modules/background-task/src/status.ts:1-41`：

```text
活跃：queued → running → stopping
终态：succeeded / failed / canceled / lost
```

`canTransitionTaskStatus()` 规定终态吸收，进去就出不来。工具描述里列的是同一组（`builtin-defs.ts:657-665`）。`lost` 是给「进程没了、状态没来得及写」的任务留的。

### 完成通知只带 id

【代码事实】`local-runtime/src/background-task/conversation-delivery.ts:88-103` 的 `buildBackgroundTaskDeliveryPrompt()`：后台任务结束后发给父会话一段

```text
<background-task-finished>
  task_id / status / description / ended_at（都做了 XML 转义）
</background-task-finished>
Use task_output with each task_id to read the results … Do not mention this internal notice …
```

**结果本身不注入。** 模型要看，得调 `task_output`；`wait_ms` 上限 30 秒（`builtin-defs.ts:692-704`）。

【推断】两个效果。其一，子任务的长输出不会自动灌进父上下文，父 agent 自己决定读不读、读多少。其二，子任务的输出（可能包含它读到的网页、文件）不会以宿主消息的身份出现，降低了「子任务输出伪装成系统通知」的面——注入的只有宿主自己生成、转义过的几个字段。

### `task_append`：追加而不是重开

【代码事实】`builtin-defs.ts:614-640`：给已有任务追加工作，结果分三种——`activated`（任务已停，追加的消息重新激活它）、`steered`（任务在跑，作为 steering 并进当前轮）、`duplicate`。描述写明「A steered append cannot be split out of the Turn it joined」、「Once the append is admitted, ending or aborting the parent turn does not cancel the child」，且只有任务的所有者能追加。

### 没找到的上限

- 后台 bash 的最长运行时间 `MAX_BACKGROUND_BASH_MAX_RUN_MS = 2_147_483_647`（`bash-runner-limits.ts:6`），即 32 位有符号整数的上限，约 24.8 天。
- 【代码事实】全仓搜并发上限，只找到 miniapp 的 `MAX_RUNNING_PLUGIN_SERVICES = 3`；后台 task 没有全局并发数限制。【推断】模型一口气起十个后台 worker，系统不会拦。

## 6.5 子任务报告：只交事实，不做裁决

【代码事实】`agent-tools/src/desktop/task-verification.ts`（137 行）。`formatLocalTaskParentReport()`（`:120-137`）给父 agent 的报告逐项列出：`run_status`、请求的与实际解析到的 agent、`model_verdict`、`file_change`、`changed_files`、`observation_notes`、`final_text`、`error_message`。它的文档注释说：「never compares the model verdict with file observations and does not synthesize a second status」。

两个细节：

- `parseModelVerdict()`（`:19-28`）：子 agent 最后的回答里要有且只有一行 `VERDICT: …`；没有、有多行候选、格式含糊，一律返回 `undefined`，不猜；
- 文件变化观测附一句固定声明（`FILE_CHANGE_OBSERVATION_NOTICE`，`:9-10`）：「best-effort observation only; not a filesystem sandbox or security boundary; no_observed_change does not prove that no write occurred」。

【推断】宿主把「模型说了什么」和「宿主观察到什么」并排交给父 agent，自己不下结论。这和 6.3 的发现互相印证：宿主知道自己的观测不是边界，所以明说。

## 6.6 Goal：codex 风格的长任务

【代码事实】`agent-modules/goal`（17 个文件 / 3,090 行），`index.ts:1-6` 自称「codex-style Thread Goal primitives」。

### 状态

`types.ts:40-47` 定义 6 种：`active`、`paused`、`blocked`、`complete`、`budget_limited`、`usage_limited`。终态是后四种里的 `complete`、`blocked`、`budget_limited`、`usage_limited`（`:222-234`）；只有 `active` 会自动续跑（`:174-181`）。

【代码事实】同一个 `index.ts:1-6` 的头注释写的是「4-state status model」，与 6 种状态不一致。

续跑会因为外部条件暂停，等待原因有八种（`THREAD_GOAL_WAIT_REASONS`）：问卷、权限、计划、必需的后台任务、自动化归属冲突、依赖不可用、验收中、未知。

### 续跑提示：一次完整，之后简短

【代码事实】`continuation.ts`：

- 完整的目标合同只在启动时注入一次，之后每轮只给一句短提示，注释的理由是「so canonical history stays cache-prefix stable」（`:1-7`）；
- 模板把目标当作「user-provided data… not as higher-priority instructions」；
- 连续 3 轮目标轮都报阻塞才判 `blocked`；安全拒绝立即判（`:24,66-67`）；
- 有一段完成前自查（completion audit），无进展时追加 `NO_PROGRESS_NUDGE`（`:77,148`）。

### 断路器

【代码事实】`types.ts:288-306` 记三个计数：`replyFingerprint`（回复是否重复）、`noProgressStreak`、`noToolStreak`，共用一个上限（`store-port.ts:176`）。默认值（`config/src/goal-config.ts:62-79`）：

| 项 | 默认 |
| --- | --- |
| 预算宽限步数 `budget.graceSteps` | 1（最大 3） |
| 重复回复上限 `breaker.repeatedReplyLimit` | 3 |
| 验收连续不通过上限 `verifier.repeatedNotMetLimit` | 5 |
| 验收证据 | `brief` |
| evaluator | 同路由小快模型，`maxTokens 32_000`，60 秒，最多重试 1 次 |

【推断】runaway-guard（第 3 章）只提醒、不拦；goal 的断路器是会真停的。两者分工：一轮内的打转交给前者，跨轮的空转交给后者。

### 谁来验收：按计费路由决定

【代码事实】`verification/verification-policy.ts:18-25`：

```ts
if (kind === 'managed_token_plan' || kind === 'minimax_api_key') return 'subagent';
return 'none';
```

头注释（`:4-16`）：模式不是 goal 的持久属性，没有 UI，每次结算时按这一轮实际用的路由重新算；「BYOK routes … spend the user's own quota, so we accept the worker's completion proposal instead of silently doubling their bill」。用户在配置里写 `goal.verification` 可以覆盖（`local-runtime/src/thread-goal/verification-dispatch.ts:158-163`）。

`subagent` 验收（`verification/subagent.ts`）：

- 起一个只读的 verifier 子 agent（`:68-71` 注释：「The child can only return untrusted text」）；
- `PASS → met`、`FAIL → not_met`、`PARTIAL → inconclusive`（`:184-197`）；
- 没有 `impossible`：注释（`:174-183`）说认为目标做不到的 verifier 会落到 `PARTIAL`，阻塞交给 `notMetStreak` 断路器，「on five independent verifications instead of one」；
- 格式不对重试一次，带 `SCHEMA_RETRY_INSTRUCTION`，再不对记 `schema_error`（`:64-65,164-169`）。

第三种 `evaluator`（`evaluator-adapter.ts`）不带工具（`tools: readonly []`）、关思考（`thinking: 'off'`），只看文字证据，默认不选，要在配置里显式打开。

【推断】「做不到」这个判决被故意拿掉：一次验收说「不可能」就终止，代价太高；五次独立的「不通过」才停，把单次误判的影响压下来。另一面是 BYOK 用户的 goal 由干活的 agent 自己宣布完成——这是在「花用户的钱」和「自证」之间选了前者的反面，并写进了注释。

## 6.7 缺口

| 缺口 | 证据 | 后果 |
| --- | --- | --- |
| 子任务共享父工作区，没有 worktree | `local-task-runner.ts:84-97`；`fork-worktree-adapter.ts` 只服务会话 fork | 并行写者的冲突只靠提示「disjoint files」 |
| explore 只读靠沙箱，沙箱默认关 | `local-turn-execution-preparation.ts:257-258`；`local-sandbox-service.ts:343-377` | 默认下 explore 的 bash 能写文件 |
| verifier 无只读标记 | 同上，条件只认 `explore` | 「no project-file changes」只是提示 |
| 后台任务无并发上限 | 全仓只有 miniapp 的 `MAX_RUNNING_PLUGIN_SERVICES` | 一次起多少个都不拦 |
| BYOK 的 goal 自证完成 | `verification-policy.ts:18-25` | 不配置就没有独立验收 |
| goal 文档说 4 态，代码 6 态 | `index.ts:1-6` vs `types.ts:40-47` | 读注释的人会少算两种终态 |

## 6.8 本章结论

- 三个内置角色加通用 `mavis`；保留名冲突改名，内置待遇只给可信来源。委派不提权，子 agent 没有父历史，深度为 1。
- 前台 `task` 是 `sequential`，同一批工具调用全部串行；并行只能走后台。
- 前后台共用一个 7 态状态机，终态吸收；完成通知只带 id 和状态，结果要 `task_output` 去取。
- 子任务报告把模型的 VERDICT 和宿主的文件观测并排给父 agent，不合成结论，并声明观测不是安全边界。
- 角色的工具上限是删工具，不是限能力：`bash` 都在。explore 的只读文件系统只在沙箱里生效，默认不生效。
- Goal：6 态、续跑提示保持缓存前缀稳定、三类断路器、按计费路由选验收方式；`impossible` 被故意去掉，交给五次不通过的断路器。
