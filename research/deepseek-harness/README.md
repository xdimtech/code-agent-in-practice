# deepseek-harness 拆解

**状态**：⬜ 待开始

| 项 | 值 |
| --- | --- |
| 厂商 | DeepSeek |
| 基准 commit | `21638c56` |
| 版本 | 0.1.7-rc.2 |
| 与 pi 的关系 | **无功能依赖**（对照组之一）—— 见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |

## 它不使用 pi

这一点必须先说清楚，否则整章的定位会错。

【代码事实】`@earendil-works/pi-ai@^0.85.1` 在全仓只出现于一处 `package.json`：`packages/llm/llm-pi-ai/package.json:47`。围绕它的四条事实：

1. 该包 `@deepseek-ai/dsh-llm-pi-ai` 自称 "design-verification twin of dsh-llm-deepseek" —— 与官方 adapter **并行的第二实现**；
2. 在 `packages/bundle/base/cordis.patch.yml:123-128` 以**默认休眠**方式挂载。注释明言"零路由、模型选择器里不多出条目，直到 `llm-pi-ai:` 配置段提供 provider profile"；
3. **DeepSeek 自己的模型路径不经过它** —— 走 `llm-deepseek` / `llm-deepseek-account`（同文件 `:525-529`），`@deepseek-ai/dsh-llm-deepseek` 的依赖里没有任何 pi 包；
4. `apps/cli` 与 `packages/core/agent-loop` 只在 `devDependencies` 中引用它；跨包源码引用仅一处测试（`packages/core/agent-loop/tests/system-prompt-admission.spec.ts:6`）。

【推断】它存在的目的是证明自家 LLM 接缝与 provider 无关 —— 一个"用户想接第三方模型"的可选能力，而非对上游的依赖。

## 因此它在本书里的角色是对照组

内核是 [Cordis](https://github.com/cordiverse/cordis) DI 容器（vendor 在 `vendor/cordis`）上的 **315 个 package**，走到了插件化的另一个极端：`compaction` / `context` / `spill` / `guard` / `subagent` 各自成包。

对照价值在于：它在**没有 pi 的路径依赖**的前提下，独立面对了与三家衍生方完全相同的那批策略问题。所以当三家做法趋同时，它能回答一个关键问题——

> 这是 pi 的路径依赖，还是这个问题本来就只有这一种解法？

与另一个对照组 `ZCode` 的分工：`deepseek-harness` 的对照角度是**架构极端**（极细粒度插件化 vs pi 的 794 行内核 + 单体产品层），`ZCode` 的角度是**完全独立演化**。

---

## 将产出什么

沿用与 [`../pi/`](../pi/) 相同的 9 章框架，保证横向可比：

| # | 章节 |
| --- | --- |
| 1 | 产品定位与能力盘点 |
| 2 | 架构分层与守卫体系 |
| 3 | Agent Loop 深度拆解 |
| 4 | 上下文工程 |
| 5 | 工具面、权限与 Code Mode |
| 6 | 多 Agent 编排 |
| 7 | 扩展性与生态策略 |
| 8 | 可观测性 |
| 9 | 评估、风险与建议 |

**与三家衍生方不同，本仓库不需要先与 pi 做 diff** —— 没有 diff 可做。它要做的是**独立解法的平行记述**，然后在第 35 章与 pi 系放在一张表里对照。

对照用的探针清单见 [`../pi/09-assessment-risks-recommendations.md`](../pi/09-assessment-risks-recommendations.md) 附录 A–H。逐项回答同一批问题，才能进同一张表。

### 一个额外优势

它是唯一 git 历史可用的对照组：20,177 commit / 73 贡献者（`ZCode` 只有 3 个 squash commit）。演进过程本身是一手材料。

## 阻塞了哪些正文

- 第三部分（第 16–21 章）各章 `X.2` 表格的对照组行
- [第 34 章](../../book/06-four-vendors/ch34-deepseek.md)、[第 35 章](../../book/06-four-vendors/ch35-comparison.md)、[第 36 章](../../book/06-four-vendors/ch36-lessons.md)

产出流程见 [CONTRIBUTING](../../CONTRIBUTING.md#研究底稿的产出流程)。
