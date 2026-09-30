# kimi-code 拆解

**状态**：⬜ 待开始

| 项 | 值 |
| --- | --- |
| 厂商 | 月之暗面 |
| 基准 commit | `65ae3e36` |
| 版本 | 2.0.2 |
| 与 pi 的关系 | 见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |

**仅 vendor TUI**（`@moonshot-ai/pi-tui`），内核自研：`agent-core-v2`（DI × Scope）、进程分离的 client/server 形态、`kosong` provider 抽象、`kaos` 执行环境抽象。衍生程度最低但改造最深。

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
