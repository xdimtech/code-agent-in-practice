# 9. 评估、风险与建议

> 本章是前八章的综合。所有判断都可回溯到具体章节与文件行号，不引入新的未核实结论。对照基准：[pi 第 9 章](../pi/09-assessment-risks-recommendations.md)。

## 9.1 安全与透明度发现

**先说性质**：和 pi、Step-Code 一样，没有一条是「数据已经泄露」或「凭据已经提交」。区别在形状上：pi 的问题多是「机制层没给策略」；Step-Code 是「给了策略，覆盖不全」；minimax-code 是第三种——**策略写好了，默认没开，或者只在一条路径上开**。沙箱、环境净化、MCP 延迟暴露、子任务只读，都属于这一类。

| # | 级别 | 问题 | 位置 | 来自 pi？ |
| --- | --- | --- | --- | --- |
| **F1** | 🟠 高 | **auto 模式默认把命令和近几轮对话发给云端分类器**；这条流量不归三个遥测开关管 | `permissions/facade.ts:813-856,1248-1276`；`config.ts:1709`（[§5.3](./05-tools-permissions.md#第三层云端分类器auto-模式)） | 新增 |
| **F2** | 🟠 高 | **沙箱默认关，且只有 macOS 后端**；于是 explore 角色的「只读」在默认配置下不生效 | `sandbox-settings.ts:13-16`；`sandbox/initialize.ts:35-40`；`local-sandbox-service.ts:343-377`（[§5.5](./05-tools-permissions.md#55-沙箱有默认关)、[§6.3](./06-multi-agent.md#explore-的只读靠沙箱)） | 新增（pi 没有沙箱） |
| **F3** | 🟠 高 | **凭据对模型执行的命令可见**：环境净化的 Layer B 只在 CI 下开，交互和本地 headless 都不开 | `bash-subprocess-env.ts:166-188`（[§5.6](./05-tools-permissions.md#56-子进程环境)） | 继承（pi S3），CI 下修了 |
| **F4** | 🟠 高 | **MCP stdio 子进程继承完整父环境**；同一仓库里 hook 是 17 个变量的白名单 | `transport/stdio.ts:17-20,60-67`；`runner.ts:1771-1797`（[§7.4](./07-extensibility.md#stdio-继承完整环境)） | 新增（pi 不支持 MCP） |
| **F5** | 🟠 高 | **用户 `!` 命令不过权限、不过 rm 垫片** | `tui/src/host/bash-command.ts:17-20`（[§5.7](./05-tools-permissions.md#57-用户的-三道都不过)） | 继承（pi S2），但「删除可恢复」的承诺只对 agent 成立 |
| **F6** | 🟠 高 | **Plugin Hook 失败即放行**：崩溃、超时、输出无法解析都当「没意见」 | `runner.ts:124,1442-1448`（[§7.3](./07-extensibility.md#失败即放行)） | 新增 |
| **F7** | 🟡 中 | **交互模式没有步数上限**；runaway-guard 只提醒一次、全部 fail-open | `agent-extension/src/runaway-guard.ts:67,101-128`（[§3.4](./03-agent-loop.md#34-防跑飞runaway-guard)、[§3.5](./03-agent-loop.md#35-什么时候停)） | 继承（pi S5），**部分修复** |
| **F8** | 🟡 中 | **截断的 tool call 不拦**：vendor 的 v0.79.1 没有 pi 后来加的 `stopReason === "length"` 判断，自己也没补 | `third_party/pi-mono/packages/agent/src/agent-loop.ts`（[§3.5](./03-agent-loop.md#截断的-tool-call-没有拦)） | 继承（vendor 版本早于修复） |
| **F9** | 🟡 中 | **TUI 面的内置工具不经过 local-turn 权限门** | `local-turn-permission-gate.ts:577-587`；`native-production-dependencies.ts:229`（[§7.3](./07-extensibility.md#内置工具有一道例外)） | 新增；TUI 的替代路径未追到 |
| **F10** | 🟡 中 | **诊断通道绑账号**；opt-in 后错误报告可对到具体账号 | `docs/telemetry.md:90`（[§8.4](./08-observability.md#84-diagnostics绑账号加密只发计数)） | 新增 |
| **F11** | 🟡 中 | **反馈描述是原文**，打码只按形状识别 | `user-facing-failure.ts:48-67`；`docs/tui-capabilities.md:51-61`（[§8.7](./08-observability.md#唯一的自由文本)） | 新增（替代了 pi 的 `/share`） |
| **F12** | 🟡 中 | **工作区边界是 ask 不是 deny**；bypass 下可写工作区外 | `checkers.ts:832-847`（[§5.3](./05-tools-permissions.md#第一层本地硬检查)） | 新增（pi 没有边界） |
| **F13** | 🟡 中 | **`reverse-shell` / `encoding-bypass` 不在最终拒绝集合里** | `dangerous-patterns.ts:190-202`（[§5.3](./05-tools-permissions.md#第二层确定性引擎)） | 新增 |
| **F14** | 🟢 低 | **自更新允许生命周期脚本**：`--ignore-scripts=false`，脚本白名单限定为产品包和 `better-sqlite3` | `tui/src/update/install-source.ts:201-205` | 新增 |
| **F15** | 🟢 低 | **Plan 模式不管 `bash`**；能否用 `bash` 写文件由权限层照常判 | `plan/tool-guard.ts:33-60`（[§5.1](./05-tools-permissions.md#plan-模式唯一可写的是计划文件)） | 新增 |

### 为什么 F1 排在第一

它是唯一一条**默认开、离开本机、且不在遥测开关里**的数据流：

- 默认权限模式是 `auto`（`config.ts:1709`）；
- 登录用户每一条「规则没判定」的命令，连同最近 3 条用户消息和最近 5 条消息（截断后），发给云端分类器（[§5.3](./05-tools-permissions.md#第三层云端分类器auto-模式)）；
- `docs/telemetry.md:3` 明说三个开关不覆盖「模型请求」——分类器请求在性质上更接近模型请求，但用户读遥测文档时未必这么理解。

它的另一面是 minimax 最值得肯定的一处设计：分类器**永远不会 deny**，`block`、`confirm`、超时、异常一律退回问用户（`facade.ts:838-899`）。云端只能让用户少被问一次，不能替用户拒绝或越过用户放行。

### F2 和 F5 是「承诺的边界」

minimax 在两处做了强承诺：「删除一定可恢复」（[§5.4](./05-tools-permissions.md#54-删除走回收站)）和「explore 不能改文件」（`subagent-roles.ts:8-12`）。前者靠 PATH 垫片 + 失败关闭兑现，是全仓最扎实的机制；但用户的 `!` 不走垫片。后者靠沙箱兑现，而沙箱默认关。两处的共同点是：**承诺写在描述里，兑现只在一条路径上**。修法都不难——`!` 的执行加一个 `prependPath`；explore 在沙箱关闭时把 `bash` 也从工具里去掉，或在描述里写明「沙箱关闭时不保证只读」。

### F3、F4 与 hook 白名单：三条子进程路径，三种口径

| 子进程 | 环境处理 | 能看到 API key？ |
| --- | --- | --- |
| Plugin Hook | 17 个变量的白名单 | 否 |
| 模型的 `bash` | Layer A 总开；Layer B 只在 CI | 交互和本地 headless 能 |
| MCP stdio | `{ ...process.env, ...config.env, ...injected.env }` | 能 |

同一个仓库里已经有最严格的写法（hook），把它推广到另外两条路径是现成的。`bash` 的 Layer B 关闭是有意的（注释写「CC parity」）；MCP 那条没有类似说明。

## 9.2 核心判断

### 1. pi 是一个库，不是一个框架

minimax 用 pi 的 L1 循环、L2 `Agent`、provider 适配器和若干零件，不用 L3 `AgentSession`、扩展系统和 vendor 进来的 tui（[§2.1](./02-architecture-and-guardrails.md#21-包结构pi-沉到最底下)）。`Agent` 每轮新建、只执行一轮（[§3.1](./03-agent-loop.md#31-三层结构谁的代码)）。

【推断】这是和 Step-Code 相反的一极：Step-Code 证明了 pi 的扩展 API 撑得起产品策略层；minimax 选择不用它，自己写了 55 万行运行时，换来的是 pi 的扩展 API 够不着的那些控制点——往 L1 开的四个接缝、请求视图与持久历史分离、每次请求前的准入检查。

### 2. 「放得下」是一条贯穿全仓的规则

任何往请求里加东西的路径，都要证明加完还放得下（[§4.3](./04-context-engineering.md#放得下才算完成)、[§4.5](./04-context-engineering.md#真正在跑的两个提醒)）：

| 路径 | 判据 | 位置 |
| --- | --- | --- |
| checkpoint 生成后 | `fitsFinalRequest()`，不过就抛 `POST_ADMISSION_FAILED` | `compact-context.ts:118-153,615-621` |
| system-reminder 注入前 | `fitsReminderInFinalRequest()`，不过就这次不提醒 | `reminder-admission.ts:8-26` |
| 工具输出外置 | 本轮有 `read` 才替换，否则保留原文 | `tool-output-budget.ts:60-62` |
| 工具结果归档 | 没有 `read` 就只能删，回执写明「unavailable」 | `automatic-context-compactor.ts:329-331` |

代价是 [§4.3](./04-context-engineering.md#和-pi-还剩的关系) 的那一条：全押在事前，没有「provider 报超长后压缩重试」的事后恢复。

### 3. 机制优先于提示

| 场景 | 提示 | 机制 |
| --- | --- | --- |
| 删除 | bash 描述里写「用 `rm`」 | PATH 垫片；垫片缺失就拒绝启动 bash（`ensure-rm-shim.ts:82-110`） |
| bypass | — | bypass 放松确认，不放松可恢复；删除动词嗅探直接拒（`bash-permission.ts:1218-1289`） |
| 子任务递归 | 合同写「Do not delegate」 | 工具层去掉 `task` / `task_append`（`local-turn-tool-catalog.ts:308`） |
| 插件 hook 放行 | — | allow 只能免掉兜底询问，免不掉安全询问和 deny（`facade.ts:1289-1302`） |
| 遥测 | — | 配置读不出来按「没授权」（`telemetry-policy.ts`） |

而 F2、F15 是这条规则的反例：explore 的只读、Plan 模式的「只写计划」，在默认配置下只有提示。

### 4. 公开投影的工程纪律

守卫集中在「公开投影会出什么错」：内部地址、退役模块、必需能力是否在产物里、根许可的 sha256、全历史密钥扫描（[§2.3](./02-architecture-and-guardrails.md#23-守卫一条-pnpm-verify14-道门)）。文档对「验证过什么」非常克制：版本号相同不证明可复现、schema 2 生产接收未测、能力表证据是 0.3.11 的（[§8.9](./08-observability.md#89-版本与证据基线写下来的和跑过的)）。

但没有包分层闸门；425 个测试文件只有 156 个进了闸门（[§2.3](./02-architecture-and-guardrails.md#测试只跑了一部分)）。

## 9.3 真实的债

| 债 | 位置 |
| --- | --- |
| 两代运行时并存：v1 138,172 行、v2 195,133 行；权限 facade、rm 垫片、SQLite、错误上报都在 v1 | [§2.1](./02-architecture-and-guardrails.md#两代运行时)；[§8.4](./08-observability.md#reporter-的四道闸) |
| 同进程 SPI 11 个适配器，6 个没有生产消费者；注释说「seven」 | `native-production-dependencies.ts:102-105`（[§7.2](./07-extensibility.md#72-进程内9-个-hook11-个适配器6-个没人用)） |
| 同一个包里两条压缩触发线（provider-budget 与 M3 90%），差 3.3 万 token | `provider-budget.ts:17-42` vs `settings.ts:13-37`（[§4.2](./04-context-engineering.md#42-预算从留多少变成最多送多少)） |
| `shared` 里的记忆上限 15/18/20 KB 没人 import；真实阈值是 v1 的 64 KB，到了也只是快照 | `memory-limits.ts:10-20`；`local-memory-facade.ts:13,218-226`（[§4.6](./04-context-engineering.md#三个上限一个没人用)） |
| 补丁台账 38 条，34 条「not opened」；一条标题层级写错 | `MINIMAX_CHANGES.md:328`（[§2.2](./02-architecture-and-guardrails.md#补丁台账)） |
| 注释与代码不一致：bash 环境「non-interactive 自动 scrub」、goal「4-state」、适配器「seven」 | `bash-subprocess-env.ts:17`；`goal/src/index.ts:1-6`；`native-production-dependencies.ts:102-105` |
| 版本表写 0.4.12，manifest 是 0.5.0 | `docs/open-source-status.md:9-10`；提交 `13fd900`（[§8.9](./08-observability.md#89-版本与证据基线写下来的和跑过的)） |
| `@see packages/agent-core/ARCHITECTURE.md` 指向不存在的文件；`.minimax-vendor.json` 的 `policy` 相对路径指错 | `pi-turn-runner/index.ts:16`；[§2.2](./02-architecture-and-guardrails.md#两处小的不一致) |
| 指令文件只看工作区根；全局 `AGENTS.md` 超 32 KiB 整个丢掉 | `static-prompt-reader.ts:121-131,238-247`（[§4.1](./04-context-engineering.md#指令文件只看工作区根先到先得)） |
| 子任务没有 worktree；后台任务没有并发上限 | `local-task-runner.ts:84-97`（[§6.2](./06-multi-agent.md#没有-worktree-隔离)、[§6.4](./06-multi-agent.md#没找到的上限)） |
| Windows CI 暂停 | `ci.yml:58` |
| 历史：内部 monorepo 的公开投影，导入之前的演化不可见 | `c59cf53`（[§1.2](./01-product-teardown.md#12-基本面)） |

已经还掉的一笔：根 `LICENSE` 一度是从 sandbox-runtime 拷过来的、带着别家的署名，2026-09-12 审查时发现并改正，之后源码闸门钉住了根许可的 sha256（`LICENSE-STATUS.md:19-21`）。

## 9.4 pi 的缺口，minimax-code 补了哪些

| pi 的发现 / 缺口 | minimax-code |
| --- | --- |
| S1 扩展安装不禁脚本 | ✅ 不适用：插件包是摘要校验的目录，不跑 npm；本地包安装直接拒（`desktop-facade.ts:363-365`）。自更新另有 F14 |
| S2 `!` 绕过权限门 | ❌ 未改，且不过 rm 垫片（F5） |
| S3 凭据对命令可见 | ⚪ CI 下修了，交互和本地 headless 未改（F3） |
| S4 `/share` 上传 system prompt | ✅ 没有 `/share`；反馈只发计数，但描述是原文（F11） |
| S5 零防死循环 | ⚪ runaway-guard 只提醒、fail-open；headless 有 `--max-steps`，交互没有步数上限（F7）；goal 有会真停的断路器 |
| S6 `/privacy` 不存在 | ✅ `mcode telemetry status` / `preview`，三通道默认关 |
| S7 缺 `unhandledRejection` | ✅ `process-guards.ts:151-152` 处理；incident 用 `uncaughtExceptionMonitor` 只观察 |
| S8 telemetry 的 `sensitive` 字段是装饰 | ✅ 不适用：usage 事件按 `EVENT_PROPERTY_KEYS` 白名单挑属性，字段全是枚举 |
| 缺口：无 provider 录制回放 | ⚪ 有 session report 的 `llm-call.json`（本地证据），不是回放 |
| 缺口：巨型文件 | ⚪ pi 的两个巨型文件不在产品路径上；自己的 `runner.ts` 2,348 行、`bash-permission.ts` 1,520 行 |
| 缺口：无架构守卫 | ⚪ 14 道闸门，但都是「公开投影」方向的；没有包分层闸门 |
| 缺口：v2 门面不可用 | ✅ 不适用：pi 的会话层整个没用 |
| 「No X」清单 6 项 | ✅ 全部补上，另加 goal、cron、记忆、沙箱、凭据租约 |

## 9.5 给下游的建议：从 minimax-code 可以抄什么

### 直接抄

1. **删除走 PATH 垫片，垫片缺失就拒绝启动 bash**；绕行的写法（绝对路径、`\rm`、`unlink`）在权限层单独拦（[§5.4](./05-tools-permissions.md#54-删除走回收站)）。
2. **bypass 放松确认，不放松可恢复**（`bash-permission.ts:1236-1241`）。
3. **云端判定只能放行或退回问用户，永不拒绝**（`facade.ts:838-899`）。
4. **停下时给每个未执行的 tool call 补一条错误结果**，让持久历史本身成对（[§3.2](./03-agent-loop.md#停下来时历史仍然成对)）。
5. **任何往请求里加东西的路径都过准入**（9.2 第 2 条）。
6. **防跑飞的提醒先占位再 steer**、一轮一次、HMAC 指纹、文案明说「不要写进记忆」（[§3.4](./03-agent-loop.md#34-防跑飞runaway-guard)）。
7. **远端配置值坏了算「没覆盖」，不算「开」**（`runaway-guard-config.ts:10-22`）。
8. **hook 的环境用白名单，事件用共享预算**（[§7.3](./07-extensibility.md#73-进程外之一plugin-hook)）；hook 的 allow 只能免掉兜底询问。
9. **插件用 sha 钉版本 + 树摘要 + 不可变快照**，扫描期间变了就抛错、不吞（[§7.5](./07-extensibility.md#75-进程外之三plugin-包)）。
10. **遥测全关、各自 opt-in、配置读不出来按没授权、发之前能 preview**；usage 每事件一个新随机 ID（[§8.1](./08-observability.md#81-三个通道一个判定函数)、[§8.2](./08-observability.md#82-usage每个事件一个新-id)）。
11. **诊断发计数，不发原文**（`diagnostic-counts-v1`，[§8.7](./08-observability.md#87-反馈发计数不发原文)）。
12. **子任务报告把模型的 verdict 和宿主的观测并排给出，不合成结论**，并声明观测不是安全边界（[§6.5](./06-multi-agent.md#65-子任务报告只交事实不做裁决)）。

### 抄之前先补

1. 把 hook 的环境白名单推广到 MCP stdio 和 `bash`（F3、F4）。
2. `!` 的执行加上 rm 垫片（F5）。
3. 沙箱关闭时，explore 不给 `bash`，或者在描述里写明不保证只读（F2）。
4. 交互模式加一个会真停的步数上限；runaway-guard 的提醒可以留着做第一道（F7）。
5. 在 L1 里补上「`stopReason === "length"` 时判 tool call 失败」（F8）。
6. 在遥测文档里明说 auto 模式的分类器会发什么（F1）。
7. 给 manifest 版本和文档版本加一条一致性检查（[§8.9](./08-observability.md#89-版本与证据基线写下来的和跑过的)）。

## 9.6 一句话结论

minimax-code 把 pi 降成一个库，在上面自己写了一整套运行时：凡是它写成机制的地方（删除可恢复、准入检查、历史成对、遥测默认关）都做得很扎实；凡是只写成默认关闭的开关或只写在描述里的地方（沙箱、环境净化、子任务只读），在默认配置下就不生效。

## 附：探针 A–H 的答案

### A. 规模与定位（第 1 章）

- 自有代码 556,959 行，是 vendor 的 pi（102,623 行）的 5.4 倍；两代运行时并存。
- provider 层是 pi 的三种协议（`openai-completions` / `openai-responses` / `anthropic-messages`），加 MiniMax 托管。
- 入口：交互 TUI、`mcode exec`、`mcode acp`；pi 的 rpc 被 ACP 取代。
- 「No X」6 项全部补上。
- 没有回流上游：台账 38 条里只有 1 条到过上游。
- 历史是公开投影，导入之前不可见。

### B. 架构与守卫（第 2 章）

- 14 道闸门集中在公开投影风险；没有包分层闸门。
- 供应链：Action 钉 SHA、冻结 lockfile、gitleaks 扫全历史和产物、overrides 钉传递依赖。
- 425 个测试文件里 156 个在闸门里。
- 两份不同版本的 pi：vendor v0.79.1（agent / ai / coding-agent）和终端引擎 fork 0.84.2+。

### C. Agent Loop（第 3 章）

- L1 / L2 在用，往 L1 开了四个接缝；L3 不用。
- 停下时补齐未执行的 tool call，历史成对。
- 重试 5 次、单次 30 秒、总耗时 120 秒。
- runaway-guard：五类信号、一轮一次提醒、fail-open、不拦。
- 交互模式没有步数上限；headless `--max-steps` 退出码 7。
- 截断 tool call 不拦（vendor 版本早于 pi 的修复）。

### D. 上下文工程（第 4 章）

- system prompt 分层拼装，每段带区间标记。
- 指令文件只看工作区根，`CLAUDE.md` 优先于 `AGENTS.md`。
- 预算：`min(95%, 窗口 − 16K, 窗口 − 输出 − 2K)`，提前最多 32K 触发；输出预算越大触发越早。
- `o200k_base` BPE 估算，偏保守；没有事后溢出恢复。
- 压缩是六级阶梯 + 生成后准入；checkpoint 八段，结构化状态由宿主追加。
- 记忆三层，注入取末尾 10K + 摘要 4K。

### E. 工具与权限（第 5 章）

- 19 个内置工具，`bash` 仍是 pi 的实现，外加超时上界 120 / 300 秒。
- 权限三层：本地硬检查 → 确定性引擎（15 类 HARD，10 类最终拒绝）→ 云端分类器（默认开，永不拒绝）。
- 删除可恢复是执行层承诺。
- 沙箱、环境净化、MCP 延迟暴露都写好了，默认关（或只在 CI 开）。
- `!` 不过权限也不过垫片；headless 拒绝 ask。

### F. 多 Agent（第 6 章）

- `task` 工具 + explore / worker / verifier + 通用 `mavis`；深度 1；委派不提权。
- 前台 `sequential`，并行只走后台；前后台共用 7 态状态机。
- 完成通知只带 id，结果用 `task_output` 取。
- 没有 worktree，没有后台并发上限。
- Goal：6 态、三类断路器、按计费路由选验收方式；BYOK 默认自证。

### G. 扩展性（第 7 章）

- 五条扩展路径，只有同进程 SPI 没有隔离，且只对第一方开放。
- Plugin Hook：11 事件、3 种格式、共享预算、并发 8、环境白名单、失败即放行。
- MCP 补上，但 stdio 继承完整环境。
- 插件包 sha256 树摘要 + 不可变快照；市场注册和 GitHub 导入不在 CLI/TUI 露出。
- pi 的扩展系统不在产品路径上。

### H. 可观测性（第 8 章）

- 三个上传通道默认全关，各自 opt-in；全局关闭环境变量优先；`preview` 永不发送。
- usage 每事件新随机 ID；metrics 要托管 + opt-in；diagnostics 绑账号、加密、只发计数。
- 日志一个门面，TUI 下全进盘，按小时滚动，50 MiB / 512 MiB / 7 天。
- incident 本地优先，schema 1 直接删。
- `/doctor` 只查配置文件。
- auto 模式的分类器流量不在遥测开关里。
