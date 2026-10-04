# 1. 产品定位与能力盘点

> 对照基准：[pi 第 1 章](../pi/01-product-teardown.md)。本章只写 Step-Code 相对 pi **变了什么**；没提到的默认与 pi 相同。

## 1.1 它自己怎么说

【文档】`README.md` 的第一句定位是「Swift execution, long-horizon reliability, and high token efficiency」，卖点列了五条：token 效率（与 Step 模型一起调优，长任务拆给并行子 agent）、静态站点发布（内置 StepPage）、长任务托管（`/goal` 与 `/cron`）、Step provider 接入、生态兼容（MCP、Agent Skills、「most Claude Code plugins are directly compatible」）。

同一份 README 还写了一句对本书很重要的话：

> The default Step Code entrypoint exposes one built-in model provider: **Step (StepFun)**. The profiles below select the Step service region and billing method; they are not separate providers.

pi 的定位是「给会写扩展的人一个最小内核」；Step-Code 的定位是「给 Step 模型的用户一个装好策略的终端产品」。两句话的差别决定了后面所有 diff 的方向：**pi 拒绝做的，Step-Code 几乎都做了；pi 铺开做的（40 家 provider），Step-Code 收成一家。**

## 1.2 基本面

| 项 | pi | Step-Code |
| --- | --- | --- |
| 可执行文件 | `pi` | `step`（`apps/cli/package.json:5-7`） |
| 包管理 | npm workspaces | pnpm workspaces（`pnpm-workspace.yaml`） |
| 包数 | 10 个 `packages/*` | 7 个 `packages/*` + 1 个 `apps/cli` |
| 配置目录 | `~/.pi` | `.stepcode`（`packages/coding-agent/src/step/environment.ts:5-6`） |
| 许可 | MIT | MIT，`LICENSE` 保留两行版权 |
| 安装 | `npm i -g` | 官方安装脚本下载二进制并校验 sha256；`step update` 走同一份发布清单（`step/local-update.ts:115-118` 校验失败即抛错） |
| 历史 | 完整 | 18 个提交，首个提交一次加入 1,407 个文件 |

【代码事实】二进制分发是 Step-Code 相对 pi 的一个硬约束来源：第 6 章会看到，workflow 沙箱之所以选 QuickJS/WASM 而不是 `isolated-vm`，直接原因就是「发布的二进制是 bun 编译的，原生模块加载不了」（`features/workflow/vm.ts:1-37`）。

## 1.3 代码规模分布

统一口径的总表在 [README](./README.md#规模统一口径)：pi 556 文件 / 127,546 行，Step-Code 534 文件 / 151,503 行，净增 18.8%。净增是两个方向相抵的结果：

- **减**：`ai` → `providers` 少了 11,765 行（内置 provider 全部移走），`client` / `server` / `session-backends` / `evals` 四个包共 7,287 行整包删除，`protocol` → `contracts` 从 1,245 行缩到 479 行。
- **增**：`coding-agent` 多了 18,676 行，`apps/cli` 是新的 23,085 行（其中交互模式是从 `coding-agent/src/modes/interactive/` 搬来的，`apps/cli/src/ui/interactive-mode.ts` 6,753 行，pi 是 6,575 行）。

`coding-agent` 里新增的代码集中在两个目录：

| 目录 | 文件 | 管什么 |
| --- | ---: | --- |
| `packages/coding-agent/src/step/` | 61 | 产品策略：权限、命令静态分析、工具面、MCP、插件市场、登录、遥测契约、反馈包、更新 |
| `packages/coding-agent/src/features/` | 43 | 产品功能：goal / cron / plan / tasks / subagent / workflow / llama |

**两个巨型文件都没拆。** `core/agent-session.ts` 从 3,516 行长到 3,653 行，`interactive-mode.ts` 从 6,575 行长到 6,753 行并且换了目录。

## 1.4 运行模式：四种全留，再加一种

【代码事实】`apps/cli/src/modes/` 下是 `interactive.ts` / `json.ts` / `print.ts` / `rpc.ts` / `sdk-stdio.ts`。模式判定规则没动——`apps/cli/src/args/mode.ts:1-14` 的注释写明「The rules … are pi-owned」，壳层只是从一个门转出口。

新增的 `sdk-stdio` 是一个长度前缀的 SDK stdio 宿主（`packages/coding-agent/src/step/stdio-host.ts`，1,564 行），文件头 `:1-5` 说它「owns only the wire protocol」。它对沙箱的态度见[第 5 章](./05-tools-permissions.md)。

RPC 模式不但没砍，还成了子 agent 的承载面：每个子 agent 是一个 `--mode rpc --session-id` 的子进程（[第 6 章](./06-multi-agent.md)）。

## 1.5 Provider：从 40 家到 1 家

【代码事实】

- `packages/providers/src/providers/all.ts:43-47`：`builtinProviders()` 直接返回 `[]`，注释是「Step-only build: no built-in providers ship…」。
- `packages/providers/src/models.generated.ts` 只有 7 行，`MODELS` 为空；模型列表登录后从服务端发现。
- `packages/providers/src/api/` 留了 9 个协议适配器（`anthropic-messages`、`openai-completions`、`openai-responses` 等），但 Step provider 只用 `api: "openai-completions"`（`packages/coding-agent/src/features/step-provider/index.ts:36`）。
- pi 的 `ai/src/providers/` 有 87 个文件；blob diff 里 `ai → providers` 一栏「只在 pi」的 123 个文件大半出自这里。

适配器留着、provider 清零，这个组合的含义是：**协议层的通用性保留，产品层的选择权收回**。用户仍然可以通过扩展的 `registerProvider` 接别家（扩展 API 没动，见[第 7 章](./07-extensibility.md)），但开箱只有一家。

## 1.6 工程治理

| 项 | pi | Step-Code |
| --- | --- | --- |
| 提交署名 | 无约束 | `scripts/check-commit-attribution.mjs:17-21` 拒绝 AI 客户端的名字与邮箱出现在作者或 `Co-authored-by` 里（提交 `adcf37b`） |
| issue 自动关闭闸门 | 有 | 提交 `58df39d` 移除（#152） |
| 架构闸门 | 5 道 `check:*` | 18 个 `check-*.mjs`（[第 2 章](./02-architecture-and-guardrails.md)） |
| 公开边界 | — | `scripts/check-public-boundary.mjs` + `docs/open-source-status.md` |
| 回流上游 | — | 没有：历史被压平，无法 cherry-pick |

## 1.7 能力盘点：六个「No X」全部补上

pi 的 README 用一节列了六件它**不做**的事（`pi/packages/coding-agent/README.md:499-509`）。Step-Code 逐条对上：

| pi 说 No | Step-Code 的实现 | 位置 |
| --- | --- | --- |
| No MCP | stdio + streamable HTTP 两种传输，另有 Claude Code / Codex 配置导入 | `step/mcp.ts`、`step/mcp-import.ts:41` |
| No sub-agents | 内置 `subagent` / `agent_send` 工具 | `features/step-subagent.ts:541-542,613-614` |
| No permission popups | 四档预设 + shell 静态分析 | `step/permissions.ts:37-70` |
| No plan mode | `/plan` + `enter_plan_mode` / `exit_plan_mode` | `features/step-plan.ts:155`、`features/plan-mode-tools.ts:117,136` |
| No built-in to-dos | `task_create` / `task_update` / `/todos` | `features/step-tasks.ts:285,297,329` |
| No background bash | `run_command` 的 `run_in_background` | `step/tool-profile.ts:140` |

此外新增的斜杠命令：`/goal`、`/cron`、`/ultraloop`、`/workflows`、`/plugin`、`/permissions`、`/init`（`/llama` 是 pi 自带的隐藏扩展，不算）；`core/slash-commands.ts` 相对 pi 加了 `/effort`（`/thinking` 的别名），去掉了 `/share` 和 `/changelog`。

## 1.8 本章结论

1. Step-Code 是 pi 的**重组式衍生**：包改名、搬家、删四个包，但循环、工具协议、会话树、扩展 API 的主体仍是 pi 的代码（280 个文件字节相同）。
2. 产品方向和 pi 相反：pi 把策略留给用户，Step-Code 把策略装好。六个「No X」全部实现，这是最直观的证据。
3. Provider 从 40 家收到 1 家，但协议适配器和 `registerProvider` 都留着——收的是默认值，不是能力。
4. 历史没带过来、巨型文件没拆、交互模式换了目录：**跟随上游的成本从这一天起只增不减**。

**探针 A 的答案**见[第 9 章](./09-assessment-risks-recommendations.md#附探针-ah-的答案)。
