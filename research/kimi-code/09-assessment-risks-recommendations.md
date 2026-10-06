# 9. 评估、风险与建议

> 本章汇总前八章。所有判断都能追到具体章节和文件行号；唯一新增的是第 7 章留下的那个探针，本章用实机跑了（9.7）。对照基准：[pi 第 9 章](../pi/09-assessment-risks-recommendations.md)。

## 9.1 安全与透明度发现

**先说性质**：和前几家一样，下面没有一条是「数据已经泄露」或「凭据已经提交」。和别家比，kimi-code 的问题有两个特点：

- pi 的问题多半是「机制层没给策略」，Step-Code 是「给了策略，覆盖不全」，minimax-code 是「策略写好了，默认没开」。kimi-code 是第四种：**策略默认开着，但边界画在了交互用户身上**。离开交互（auto、`-p`）就几乎全部放行；离开用户级配置（项目目录里的文字文件），信任门就管不到。
- 它是唯一一家**文档和代码有系统性分歧**的。分歧有四处，每一处都是代码比文档更宽松（F2、F10、F11、F14）。

| # | 级别 | 问题 | 位置 | 来自 pi？ |
| --- | --- | --- | --- | --- |
| **F1** | 🟠 高 | **无头模式强制 auto，并去掉危险命令策略**；没有更严的无头选项 | `run-v2-print.ts:171,407-418,481`；`permissionPolicyService.ts:42-44`（[§5.5](./05-tools-permissions.md)） | 新增（pi 没有权限层） |
| **F2** | 🟠 高 | **手动模式下，git 工作树内的 `Write` / `Edit` 自动批准**；文档说每次编辑都会问 | `git-cwd-write-approve.ts:23-52` vs `interaction.md:67`（[§5.2](./05-tools-permissions.md)） | 新增 |
| **F3** | 🟠 高 | **项目里的 `local.toml` 能把工作区扩到 `$HOME`，不过信任门**；和 F2 叠起来，`~/.bashrc`、`~/.ssh/authorized_keys` 的写入不问【实机】 | `workspaceDirsService.ts:142-150`；`projectLocalConfigService.ts:181-190`（[§7.5](./07-extensibility.md)；本章 9.7） | 新增 |
| **F4** | 🟠 高 | **项目级 agent 文件能替换主 agent 的整个系统提示，不过信任门**（文档有明确警告） | `sessionAgentProfileCatalogService.ts:143-151`；`agents.md:80-82`（[§7.4](./07-extensibility.md)） | 新增 |
| **F5** | 🟠 高 | **子进程继承完整环境，没有沙箱**；`FetchURL` 默认批准，手动模式下也有一条不经确认的外发通道 | `hostProcessService.ts:36-41`；`client-stdio.ts:292-304`；`default-tool-approve.ts`（[§5.6](./05-tools-permissions.md)） | 继承（pi S3） |
| **F6** | 🟠 高 | **反馈的「日志」档上传完整会话记录和全局日志，不脱敏**；「代码库」档最多 500 MiB，只按路径名单排除 | `feedback-attachments.ts:67-70`；`filter.ts:1-6,33-91`（[§8.5](./08-observability.md)） | 替代了 pi 的 `/share` |
| **F7** | 🟡 中 | **遥测默认开**；文档称「anonymous」，登录用户的每批事件都带账号 token | `config-files.md:105`；`transport.ts:178-195`（[§8.1](./08-observability.md)） | 新增 |
| **F8** | 🟡 中 | **hook 失败即放行**（文档明说）；**hook 配置加载失败也是静默的**（文档没说） | `runHook.ts:72,111,115-123,166`；`externalHooksRunnerService.ts:114-124`（[§7.1](./07-extensibility.md)） | 新增 |
| **F9** | 🟡 中 | **插件不校验完整性，装上即启用**；它带的 hook 和 MCP 默认会跑 | `github-resolver.ts:49-94`；`manager.ts:139`（[§7.3](./07-extensibility.md)） | 新增（pi S1 的另一种形态） |
| **F10** | 🟡 中 | **`AgentSwarm` 默认批准**，文档说 swarm 模式之外要批准；默认不设并发上限 | `default-tool-approve.ts:21` vs `tools.md:94,101`（[§6.2](./06-multi-agent.md)） | 新增 |
| **F11** | 🟡 中 | **敏感文件保护只管声明了访问的工具**，`Bash cat .env` 在 yolo 下直接放行；文档说 yolo 会问 | `sensitive-file-access-ask.ts` vs `interaction.md:69`（[§5.4](./05-tools-permissions.md)） | 新增 |
| **F12** | 🟡 中 | **Tower 的 worktree 边界只拦 worker 角色的 `Write` / `Edit`**；`Bash` 和 worker 派出的子 agent 能写到边界外 | `towerService.ts:216-250`；`workerProfile.ts:14-39`（[§6.3](./06-multi-agent.md)） | 新增（实验功能，默认关） |
| **F13** | 🟡 中 | **模型能放宽自己的 goal 预算，而且不问用户**；goal 默认就没有预算 | `setGoalBudgetTool.ts:64`；`goalService.ts:273-295,376-395`（[§6.5](./06-multi-agent.md)） | 新增 |
| **F14** | 🟡 中 | **auto 模式下 ask 规则失效**；规则优先级与文档的「按顺序第一个匹配」不符 | `permissionPolicyService.ts:39-55`；`user-configured-rule.ts:20-35` vs `config-files.md:520`（[§5.1](./05-tools-permissions.md)） | 新增 |
| **F15** | 🟡 中 | **默认不限步数**；断路器只认连续相同的调用，A/B 交替逃得过 | `configSection.ts:14`；`toolDedupeService.ts:367-376,402-424`（[§3.4](./03-agent-loop.md)） | 继承（pi S5），**部分修复** |
| **F16** | 🟢 低 | **截断的 tool call 不显式拦**，参数降级成 `{}` 交给 schema 校验 | `turn.ts:572-576`；`tool-args-parse.ts:14-19`（[§3.6](./03-agent-loop.md)） | 继承 |
| **F17** | 🟢 低 | **用户的 `!` 命令不经策略链**，输出进模型上下文 | `shellCommandService.ts:91-125`（[§5.7](./05-tools-permissions.md)） | 继承（pi S2） |
| **F18** | 🟢 低 | **plan 模式不拦 `Bash`**（提示里写明） | `planService.ts:93-140`；`plan-mode-full-reminder.md:1`（[§6.4](./06-multi-agent.md)） | 新增 |
| **F19** | 🟢 低 | **本地服务端允许「非回环 + 无 TLS + 无鉴权」组合**，要叠两个显式的危险开关 | `start.ts:155-161,288-300`（[§8.7](./08-observability.md)） | 新增 |

### 为什么 F1 排在第一

第 5 章表 5-3 列了 `kimi -p` 下还在生效的约束，只有四条：配置的 `deny` 规则、重复调用断路器、用户建 goal 时给的预算、配置了的 `PreToolUse` hook。其中 goal 预算模型可以自己放宽（F13），hook 失败即放行（F8）。于是「把 kimi 放进 CI 跑」的实际边界，是用户写的 deny 规则加上断路器。

这不是隐藏的：`kimi-command.md:43` 写着 `-p` 默认就是 auto。问题在于没有反方向的选项。交互模式有三档，无头模式只有最松的一档，想要更严就只能靠外部容器。

### F2 + F3：两条各自说得通的规则，叠起来就不对了

单看 F2，「git 能撤销，所以工作树内的写入不问」说得通，`git diff` 看得见，`git checkout` 退得回。单看 `local.toml`，「记住 `/add-dir` 的选择」是正常功能，文档也提醒了要 gitignore。

叠在一起时，「在工作区内」这个前提被项目文件改写了。工作区变成了 `$HOME`，而 `$HOME` 下的文件不在那个 git 工作树里，`git checkout` 退不回来。F2 的理由在这里不成立，规则却照样生效。9.7 的探针用真实的路径判定函数跑了这条链。

### 文档与代码的四处分歧

| | 文档 | 代码 |
| --- | --- | --- |
| F2 手动模式下的编辑 | 每次都问（`interaction.md:67`） | git 工作树内不问 |
| F10 `AgentSwarm` | swarm 之外要批准（`tools.md:94,101`） | 默认批准 |
| F11 yolo 下的敏感文件 | 仍会问（`interaction.md:69`） | `Bash` 不问 |
| F14 规则顺序 | 按顺序第一个匹配（`config-files.md:520`） | deny → ask → allow 分组 |

*表 9-1 四处分歧都是代码更宽松*

【推断】四处的方向一致，说明这不是笔误，而是文档写的是「设计意图」，代码在演化中放松了。用户按文档建立的心理模型，比实际行为更保守。

和这四处形成对比，kimi 文档里有几处**主动把风险说透**的段落：hook 的 fail-open（`hooks.md:21-23`）、项目级 agent 文件的信任模型（`agents.md:80-82`）、plan 模式下 `Bash` 照常（提醒文本）、`explore` 的只读「prompt-enforced」（`profiles.ts:112`）。坦白的地方很坦白，分歧的地方都偏向宽松。

## 9.2 核心判断

### 1. pi 只剩一个被 fork 的终端渲染包

自有代码占 95%；引擎 `agent-core-v2` 是 DI 容器加三级作用域的写法，和 pi 的 L1/L2/L3 没有血缘（[§1](./01-product-teardown.md)、[§2.2](./02-architecture-and-guardrails.md)）。与 pi 的唯一交集 `pi-tui` 用 18 张意图卡跟随上游，规则是「能放进应用层的不进 fork」（[§2.5](./02-architecture-and-guardrails.md)）。

【推断】这是本书看到的「用 pi 最少」的一家。它说明 pi 的终端层可以单独拿走、单独维护；也说明 kimi 的循环、权限、上下文都不该用「pi 的某某」来理解。

### 2. 「真停，但留一步交代」

重复调用断路器（12 次之后强制结束本轮，再给一步只许写字的交接，[§3.4](./03-agent-loop.md)）和 goal 预算（预算到了，宽限一步、工具全部否决，[§6.5](./06-multi-agent.md)）是两处**独立实现**的同一个模式。另外，provider 报溢出时它会压缩、重试，并记住真实窗口（[§4.2](./04-context-engineering.md)）。

【推断】这是 kimi 对「agent 会失控」的回答：不靠步数上限，而是在「原地打转」和「超预算」这两种可识别的失控上真停，并保证停下时用户能拿到一段总结。第 33 章的最小实现选的就是断路器。

### 3. 信任门只管能执行命令的东西

能执行代码的扩展（hook、插件、MCP）要么只在用户级，要么有信任门（[§7.2](./07-extensibility.md)、[§5.8](./05-tools-permissions.md)）。项目目录里的「文字」文件不过信任门：agent 文件、技能、`AGENTS.md`、`local.toml`。

【推断】这条线背后的假设是「文字不危险」。F3 和 F4 说明这个假设不成立：一份 agent 文件**就是**系统提示，一个 `local.toml` 能改写工作区，而工作区又是 F2 自动批准的前提。

### 4. 本地看得很全，往外发默认开

本地有完整会话记录、两级滚动日志、`kimi vis` 回放、`kimi-inspect` 看 DI 层，是几家里最全的（[§8.3](./08-observability.md)、[§8.4](./08-observability.md)）。遥测有一份 80 个事件的有类型目录，每个字段都要写说明；主机名等设备头只发给自家 provider。另一面是遥测默认开、登录时带账号 token，两条管线里只有一条脱敏（[§8.1](./08-observability.md)、[§8.2](./08-observability.md)）。

## 9.3 真实的债

| 债 | 位置 |
| --- | --- |
| 导入边界的全量检查没接进 CI，实机 4 处违规 | `package.json:20`；`agent-core-v2/package.json:55`（[§2.4](./02-architecture-and-guardrails.md)） |
| 服务命名检查是死的：一半目标不存在，另一半没人调 | `scripts/check-service-naming.mjs:19-20,40`（[§2.4](./02-architecture-and-guardrails.md)） |
| Windows CI 关闭近三个月 | `ci.yml:90-109`（[§2.3](./02-architecture-and-guardrails.md)） |
| `AGENTS.md` 写四级作用域，代码是三级 | `AGENTS.md:21` vs `app/scopes.ts:3-13`（[§2.2](./02-architecture-and-guardrails.md)） |
| 两条遥测管线：常量两份，脱敏一份 | `transport.ts:24-25` / `cloudTransport.ts:53-54`（[§8.2](./08-observability.md)） |
| 两份重试工具、两份摘要前缀 | `human/llm/requester/retry.ts` / `_base/utils/retry.ts`（[§3.2](./03-agent-loop.md)）；`agent/contextMemory/` / `human/compaction/`（[§4.4](./04-context-engineering.md)） |
| 两份敏感文件名单 | `tool/path-access.ts:51-83` / `feedback/codebase/filter.ts:33-91`（[§8.5](./08-observability.md)） |
| 观测到的真实窗口不持久，每次重启都要再溢出一次 | `fullCompactionService.ts:116-119`（[§4.2](./04-context-engineering.md)） |
| 配置里的遗留字段：`maxRalphIterations` 被接受但没人读 | `configSection.ts:16,18`（[§3.8](./03-agent-loop.md)） |
| 引擎里还有 12 处未类型化的 `.track(` | [§8.2](./08-observability.md) |
| 数据目录文档没列 `device_id` 和 `telemetry/` | `data-locations.md:26-57`（[§8.1](./08-observability.md)） |

【推断】债的形状很集中：「v2 换代时留下的第二份」（遥测、重试、摘要前缀），和「写了检查但没接上」（导入边界、服务命名、Windows CI）。前一类每一笔都不大，后一类则让 CI 的绿灯比实际情况更乐观。

## 9.4 pi 的缺口，kimi-code 补了哪些

| pi 的发现 / 缺口 | kimi-code |
| --- | --- |
| S1 扩展安装不禁脚本 | ⚪ 插件是 zip，安装时不执行任何东西（`plugins.md:486-492`）；但不校验完整性、装上即启用，hook 下个事件就跑（F9） |
| S2 `!` 绕过权限门 | ❌ 未改（F17） |
| S3 凭据对命令可见 | ❌ 未改，MCP stdio 同样继承（F5） |
| S4 `/share` 上传 system prompt | ⚪ 没有 `/share`；`/feedback` 分三档，「日志」档是整个会话记录，不脱敏（F6） |
| S5 零防死循环 | ⚪ 断路器会真停；默认仍不限步数，不连续的打转抓不到（F15） |
| S6 `/privacy` 不存在 | ❌ 没有预览将发送内容的命令；遥测默认开（F7） |
| S7 缺 `unhandledRejection` | ✅ 崩溃处理器监听，并在唯一监听者时重抛以保留默认行为（`packages/telemetry/src/crash.ts:60-70`）；TUI 另有恢复终端的处理（`run-shell.ts:228`） |
| S8 telemetry 的 `sensitive` 字段是装饰 | ⚪ 引擎管线有正则脱敏，每个字段有说明；CLI 旧管线没有脱敏 |
| 缺口：无架构守卫 | ⚪ 有，而且写成了测试；但最完整的那条（导入边界）没接进 CI |
| 缺口：无 provider 录制回放 | ⚪ `wire.jsonl` + `kimi vis` 能回放会话，不是 provider 层的录制 |
| 「No X」清单 6 项 | ✅ 全部补上，另加 goal、cron、Tower、Remote Control |

## 9.5 给下游的建议：从 kimi-code 可以抄什么

### 直接抄

1. **用 bash 语法树判定危险命令**：剥开 `sudo` / `env` / `sh -c`，引号里的字符串不误报；判不了就算「无法分析」（[§5.3](./05-tools-permissions.md)）。
2. **重复调用断路器**：3 / 5 / 8 次逐级提醒，提醒贴在工具结果后面；12 次真停，再给一步只许写字的交接（[§3.4](./03-agent-loop.md)；第 33 章有最小实现）。
3. **把溢出当成一次校准**：provider 报溢出时，把「这次请求 × 0.85」记成该模型的窗口，只降不升（[§4.2](./04-context-engineering.md)）。
4. **摘要的前缀写明「当作笔记，不是证据」**（[§4.4](./04-context-engineering.md)）。
5. **成对性写时补、读时修**，读时的每一类修复都打日志、上遥测（[§4.5](./04-context-engineering.md)）。
6. **按声明的资源访问调度工具**，没声明的与一切冲突（[§3.3](./03-agent-loop.md)）。
7. **多 agent 的合并闸门**：审查必须针对当前 tip，改动必须落在 mission 的范围内，范围之间不能重叠（[§6.3](./06-multi-agent.md)）。
8. **并发预算让 429 来定**：初值无穷，第一次 429 降到「当前活跃 − 1」，慢慢恢复（[§6.3](./06-multi-agent.md)）。
9. **插件贡献的系统提示声明为参考数据**，不是指令通道（[§7.3](./07-extensibility.md)）。
10. **遥测事件写成有类型的目录，每个字段都要写说明**（[§8.2](./08-observability.md)）。
11. **主机身份头只发给自家 provider**（[§8.1](./08-observability.md)）。
12. **本地服务端的暴露默认值**：只听回环、校验 Host 与 Origin、终端和 debug 端点不出本机（[§8.7](./08-observability.md)）。

### 抄之前先补

1. 把工作区信任扩展到项目级 agent 文件、技能和 `local.toml`；至少让 `additional_dir` 不接受工作树之外的目录（F3、F4）。
2. git 内写入自动批准，只对**同一个 git 工作树内**的路径成立，不对 `additionalDirs` 成立（F2、F3）。
3. 让文档和代码一致，四处分歧至少改掉一边（表 9-1）。
4. 无头模式给一个比 auto 更严的选项，比如「ask 一律当 deny」（F1）。
5. hook 配置加载失败要报错，不能等于「没有 hook」（F8）。
6. 反馈的日志档复用引擎的 `privacy.ts` 脱敏；两份敏感名单合成一份（F6）。
7. `SetGoalBudget` 只允许模型收紧预算，放宽要问用户（F13）。
8. 把 CLI 的崩溃上报迁到引擎管线，删掉 v1 遥测（F7、9.3）。
9. 断路器再加一条「最近 N 次调用的集合重复」，抓 A/B 交替（F15）。
10. 把导入边界检查接进 CI（9.3）。

## 9.6 一句话结论

kimi-code 是一个从引擎到服务端都自己写的完整产品，pi 只剩终端渲染这一层。它在「agent 会失控」上做了本书最细的机制，包括会真停的断路器、校准真实窗口的溢出恢复和 Tower 的合并闸门。它的权限边界画在交互用户身上，离开交互就几乎全部放行。项目里的文字文件不过信任门，却能改写系统提示和工作区；文档描述的行为也比代码更保守。

## 9.7 探针：`local.toml` 把工作区扩到 `$HOME`

第 7 章 7.5 留下的问题：一个仓库提交了 `.kimi-code/local.toml`，写着 `additional_dir = ["~"]`。在默认的 Always Ask 模式下，模型写 `$HOME` 下的文件会不会被问？

**方法**【实机】：在 `/tmp` 下单独拷出 `tool/path-access.ts`（含 `isWithinWorkspace`、`isSensitiveFile`）及它的两个依赖，用 bun 直接运行仓库里的原函数。`~` 的展开规则与 `projectLocalConfigService.ts:181-190` 一致。策略顺序按 `permissionPolicyService.ts:39-55` 套用：manual 模式下策略 8（敏感文件）在策略 12（git 内写入）之前，其余策略在默认配置下不表态。仓库本身没有被改动。

```ts
const additionalDirs = [resolveDir(cwd, '~')];           // local.toml 的展开结果
const inGit = /* git -C cwd rev-parse --show-toplevel 成功 */;
for (const rel of ['.bashrc', '.zshrc', '.ssh/authorized_keys', '.ssh/id_rsa', '.env', '.aws/credentials']) {
  const p = join(homedir(), rel);
  const sensitive = isSensitiveFile(p);
  const within = isWithinWorkspace(p, { workspaceDir: cwd, additionalDirs }, 'posix');
  const verdict = sensitive ? 'ask（策略 8）' : within && inGit ? 'approve（策略 12）' : 'ask（策略 13）';
}
```

输出（`$HOME` 已替换为 `~`）：

```text
~/.bashrc                sensitive=false withinWorkspace=true  → approve（策略 12）
~/.zshrc                 sensitive=false withinWorkspace=true  → approve（策略 12）
~/.ssh/authorized_keys   sensitive=false withinWorkspace=true  → approve（策略 12）
~/.ssh/id_rsa            sensitive=true  withinWorkspace=true  → ask（策略 8）
~/.env                   sensitive=true  withinWorkspace=true  → ask（策略 8）
~/.aws/credentials       sensitive=true  withinWorkspace=true  → ask（策略 8）
```

**结论**：路径判定这一层确认了第 7 章的推断。`~/.bashrc`、`~/.zshrc`、`~/.ssh/authorized_keys` 都落在扩展后的工作区里，又不在敏感名单里，于是策略 12 直接批准。私钥、`.env`、云凭据由策略 8 拦下。

**没有验证的**：本探针跑的是路径判定函数，没有起完整的会话，也没有接模型。`workspaceDirsService` 读取 `local.toml` 不看信任状态，这一点来自代码阅读（`workspaceDirsService.ts:142-150`），没有实机复现。

## 附：探针 A–H 的答案

### A. 规模与定位（第 1 章）

- 自有代码 360,713 行，占 95.1%；来自 pi 的只有 `pi-tui`（18,680 行）。
- 形态是本地服务端 `kap-server` 加多个客户端；CLI 被规定只能通过 SDK 使用引擎。
- 入口有 TUI、`kimi -p`、`kimi web`、`kimi acp`、VS Code 扩展和 Remote Control；Web 界面只有构建产物。
- MIT 许可，历史完整可见，v1 → v2 的引擎换代就发生在公开仓库里。
- 「No X」6 项全部补上。

### B. 架构与守卫（第 2 章）

- 引擎是 DI 容器加三级生命周期作用域（App / Session / Agent）。
- 每次都跑的守卫有：三个无注释区、oxlint（含 `no-cycle`）、厂商名闸门、事件唯一性、5 分片测试、typecheck。
- 写了但没接上的有：导入边界检查（实机 4 处违规）、服务命名检查、Windows CI。
- `pi-tui` 用 18 张意图卡跟随上游。

### C. Agent Loop（第 3 章）

- 两台 xstate 状态机加一个驱动服务；默认不限步数。
- 每步最多重试 10 次，指数退避加抖动。
- 工具按声明的资源访问调度，`Bash` 永远串行。
- 断路器在 3 / 5 / 8 次提醒，12 次真停，再给一次只许写字的交接；它只认连续相同的调用。
- 中断时会补齐 tool result；截断的 tool call 不显式拦。

### D. 上下文工程（第 4 章）

- 压缩在用量达到 85%，或剩余不足 5 万 token 时触发；同样的线会阻塞下一步。
- 溢出时压缩重试，并记下真实窗口（× 0.85，只降不升）；这个值不持久。
- 压缩请求本身溢出时，按 70 / 50 / 35% 丢掉最旧的历史。
- 摘要标明「当作笔记，不是证据」；成对性写时补、读时修（9 类）。
- MCP 工具的按需加载默认关。

### E. 工具与权限（第 5 章）

- 13 条策略，按顺序取第一个表态的；模式分 manual / yolo / auto 三档。
- 危险命令用 bash 语法树判定；在 auto 和无头模式下不生效。
- 手动模式下 git 内写入自动批准，与文档相反。
- 敏感文件保护只管声明了访问的工具。
- 无头模式强制 auto；子进程继承完整环境；没有沙箱。

### F. 多 Agent（第 6 章）

- 内置 `coder` / `explore` / `plan` 三个角色，深度 1；子 agent 继承调用者的权限模式。
- `AgentSwarm` 最多 128 个，默认不设并发上限，默认批准（与文档相反）。
- Tower 有完整的合并闸门，但 worktree 边界只拦 `Write` / `Edit`。
- plan 模式不拦 `Bash`。
- goal 到预算会真停并留一步交代；预算默认没有，模型可以自己放宽。

### G. 扩展性（第 7 章）

- 扩展全是声明式的：hook 是 shell 命令，插件是清单，技能和 agent 是 Markdown。
- hook 有 20 个事件，能拦的 3 个；失败即放行，配置加载失败也静默。
- hook 和插件只在用户级；插件不校验完整性，装上即启用。
- 项目级 agent 文件能替换系统提示；`local.toml` 能扩到 `$HOME`。两者都不过信任门（9.7）。

### H. 可观测性（第 8 章）

- 遥测默认开；登录用户的事件带账号 token。
- 有两条管线，脱敏只在引擎一侧；引擎事件目录有 80 个有类型的定义。
- 设备头只发给自家 provider。
- 本地有完整会话记录、两级滚动日志、导出、回放和检查器。
- `/feedback` 分三档，「代码库」档 ≤ 500 MiB，按路径排除。
- `kimi doctor` 只查配置；本地服务端的暴露默认值稳妥。
