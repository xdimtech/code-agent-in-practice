# minimax-code 拆解

> **这是研究底稿，不是本书正文。**
> 它是[第 32 章](../../book/06-vendors/ch32-minimax.md)和第三部分「各家的选择」的证据层。版本锁定见 [`../BASELINE.md`](../BASELINE.md)。

**状态**：✅ 完成（基准 `89c930a2`，对照 pi `b79e4cc8`；vendor 的 pi 是 v0.79.1 `28df940f`）

| 项 | 值 |
| --- | --- |
| 厂商 | MiniMax |
| 基准 commit | `89c930a2` |
| 版本 | 0.5.0（根 `package.json` 与 `packages/tui/package.json`；文档仍写 0.4.12，见 [§8.9](./08-observability.md#89-版本与证据基线写下来的和跑过的)） |
| 许可 | 自有代码 MIT；vendor 的 pi 与沙箱 fork 各带各的许可（`LICENSE-STATUS.md`） |
| 与 pi 的关系 | **整栈 vendor**：`third_party/pi-mono` 源码 vendor 了 pi v0.79.1，只用它的 L1 循环、L2 `Agent`、provider 与若干零件；会话层与扩展系统不在产品路径上。见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |
| 历史 | 69 个提交；CLI 源码在 `c59cf53`（2026-09-18）一次导入 4,168 个文件——**内部 monorepo 的历史没有带过来** |

本书关于 MiniMax 的分析**只以这个公开仓库为准**；内部地址、凭据、远端配置的具体取值一律不写出。

---

## 规模（统一口径）

`.ts/.tsx`，去掉测试与 `.d.ts`：

| 范围 | 文件 | 行 |
| --- | ---: | ---: |
| 全仓 | 2,650 | 677,790 |
| `packages/` 下自有代码 | 2,350 | 556,959 |
| 其中 `local-runtime-v2`（当前运行时） | 871 | 195,133 |
| 其中 `local-runtime`（上一代，仍被复用） | 598 | 138,172 |
| 其中 `tui` | 407 | 105,334 |
| 其中 `agent-modules/*`（12 个，7 个不碰 IO） | 136 | 39,482 |
| vendor 的 pi 四个包 | 263 | 102,623 |
| vendor 的沙箱 fork | 37 | 18,208 |

**自有代码是 vendor 的 pi 的 5.4 倍。** 包级明细见 [§1.3](./01-product-teardown.md#13-代码规模分布)。

## 与 pi v0.79.1 的 diff（vendor 的四个包）

| 包 | 同路径 | 字节相同 | 改过 | 只在 minimax |
| --- | ---: | ---: | ---: | ---: |
| `agent` | 25 | 22 | 3 | 0 |
| `ai` | 54 | 31 | 23 | 1 |
| `coding-agent` | 155 | 138 | 17 | 1 |
| `tui` | 27 | 25 | 2 | 0 |

`agent` 包合计 +194 / −24 行，全部是给宿主开的控制接缝；补丁台账 `MINIMAX_CHANGES.md` 38 条，只有 1 条到过上游（[§2.2](./02-architecture-and-guardrails.md#22-vendor-的-pi改了多少)）。另有一份终端引擎 fork，基于 pi-tui 0.84.2（[§2.5](./02-architecture-and-guardrails.md#25-第二份-pi终端引擎-fork)）。

**一句话**：pi 是一个库，不是一个框架。minimax-code 把 pi 压到调用链最末端，自己写了会话、队列、压缩、权限、多 agent、遥测；它写成机制的地方很扎实，写成「默认关的开关」的地方在默认配置下不生效。

## 9 章

| # | 文档 | 一句话结论 |
| --- | --- | --- |
| 1 | [产品定位与能力盘点](./01-product-teardown.md) | 自有 55.7 万行，两代运行时并存；「No X」6 项全部补上 |
| 2 | [架构分层与守卫体系](./02-architecture-and-guardrails.md) | 14 道闸门集中在公开投影风险；没有包分层闸门；425 个测试文件 156 个进闸门 |
| 3 | [Agent Loop](./03-agent-loop.md) | 往 L1 开四个接缝；停下时历史仍成对；runaway-guard 只提醒、不拦 |
| 4 | [上下文工程](./04-context-engineering.md) | BPE 计量 + 六级压缩阶梯 + 生成后准入；没有事后溢出恢复 |
| 5 | [工具与权限](./05-tools-permissions.md) | 三层权限，云端分类器默认开、永不拒绝；删除走 PATH 垫片；沙箱默认关 |
| 6 | [多 Agent 与任务](./06-multi-agent.md) | `task` 深度 1、委派不提权；explore 只读靠沙箱；goal 按计费路由选验收 |
| 7 | [扩展性与生态](./07-extensibility.md) | 对外扩展全在进程外；hook 环境白名单，MCP stdio 继承完整环境 |
| 8 | [可观测性与运维](./08-observability.md) | 三通道默认关、各自 opt-in、能 preview；诊断只发计数 |
| 9 | [评估、风险与建议](./09-assessment-risks-recommendations.md) | 15 项发现 + 探针 A–H 全部答案 |

## 阻塞了哪些正文

- [第 32 章 MiniMax：minimax-code](../../book/06-vendors/ch32-minimax.md) —— 已解除
- 第三部分（第 16–21 章）的 `X.2 各家的选择` 中 minimax-code 一栏
- [第 6 章 成本与投入](../../book/01-choosing/ch06-cost-and-effort.md) 的 diff 规模 —— 已解除

## 引用约定

- 路径默认相对 `minimax-code/packages/`；`docs/`、`README.md`、`LICENSE-STATUS.md`、`third_party/` 相对仓库根。行号对应基准 commit。
- 证据标签：**【代码事实】** 读源码得出；**【推断】** 由代码推出但没有直接陈述；**【文档】** 仓库自带文档的原话；**【实机】** 在 macOS arm64、Node v22 上跑出来的结果（只在 `/tmp` 的副本里跑，不动原仓库）。
- 不写出：网关、分类器、遥测接收端、安装源与注册表的地址；OAuth 客户端标识；远端配置系统的名字；内部设计文档与合并请求编号。
