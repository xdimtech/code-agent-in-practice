# Step-Code 拆解

**状态**：⬜ 待开始

| 项 | 值 |
| --- | --- |
| 厂商 | 阶跃星辰（公开） |
| 基准 commit | `7dd66cb9` |
| 版本 | 0.1.0 |
| 与 pi 的关系 | 见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |

pi 的**重构式衍生**：包被重命名（`ai`→`providers`、`agent`→`agent-core`、`protocol`→`contracts/src/wire`），另加了 16 道架构 lint 闸门。同厂的 `step-harness`（内部版，pi 整树硬拷贝，基准 `fe153835` / v0.3.1）在研究工作区已有一份完整拆解，将与本目录一并发布。

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

**第 2～6 章必须先与 pi 做 diff**，区分「上游设计」与「本家改造」，否则会把上游的设计误判为本家的创新。对照用的探针清单见 [`../pi/09-assessment-risks-recommendations.md`](../pi/09-assessment-risks-recommendations.md) 附录 A–H。

## 阻塞了哪些正文

- 第三部分（第 16–21 章）的 `X.2 各家的选择`
- 第六部分对应章节
- [第 6 章 成本与投入](../../book/01-choosing/ch06-cost-and-effort.md)（需要各家的 diff 规模）

产出流程见 [CONTRIBUTING](../../CONTRIBUTING.md#研究底稿的产出流程)。
