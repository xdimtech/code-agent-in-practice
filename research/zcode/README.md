# ZCode 拆解

**状态**：⬜ 待开始

| 项 | 值 |
| --- | --- |
| 厂商 | 智谱 Z.ai |
| 基准 commit | `29628c9a` |
| 版本 | 3.14.3 |
| License | **Apache-2.0**（五家中唯一非 MIT） |
| 与 pi 的关系 | **零接触**（对照组之二）—— 见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |

## 它和 pi 没有任何交集

【代码事实】全仓 grep `earendil` / `pi-tui` / `pi-mono` / `pi-coding-agent` **零命中**。`third-party/copied-components.json` 只列 shadcn-ui 与 vercel/ai-elements，均为前端组件，与 agent 内核无关。

这是五个仓库里唯一连**接触点都没有**的一个。第 34 章的 `deepseek-harness` 至少还有一个默认休眠的可选 pi 适配器需要先解释掉，本仓库不需要。

## 因此它在本书里的角色是对照组

与另一个对照组 `deepseek-harness` 的分工：

| | `deepseek-harness` | `ZCode` |
| --- | --- | --- |
| 对照角度 | **架构极端** —— Cordis DI 容器 + 315 个包，是对 pi「794 行内核 + 6 万行单体产品层」的正面反例 | **完全独立演化** —— 既不衍生自 pi，也不走极细粒度插件化那条路 |
| 形态 | 单 CLI | **双栈**：`apps/zcode-cli/packages/*` 是独立 agent CLI，`packages/*` 是 server/web/desktop 应用栈，经 `rpc` 层复用 |
| git 历史 | 20,177 commit / 73 贡献者，可追演进 | 3 个 squash commit / 2 贡献者，**只能静态拆解** |

有两个独立对照组而不是一个，才能区分三种情况：

> 两个自研方都这么做 —— 最强的"标准解"证据（比三家衍生方趋同更强，因为它们无共享上游）。
>
> 两个自研方分叉 —— 这个问题**没有**标准解，三家衍生方的趋同只是路径依赖。
>
> 两个自研方都不这么做，但三家衍生方都这么做 —— 那基本可以确定是 pi 的路径依赖。

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

**与三家衍生方不同，本仓库不需要先与 pi 做 diff** —— 没有 diff 可做。它要做的是**独立解法的平行记述**，然后在第 36 章与 pi 系、与 `deepseek-harness` 放在同一张表里对照。

对照用的探针清单见 [`../pi/09-assessment-risks-recommendations.md`](../pi/09-assessment-risks-recommendations.md) 附录 A–H。逐项回答同一批问题，才能进同一张表。

### 三个已知的重点

1. **`formal-proof`** —— 用 d3 对 `run` / `queue` / `compact` / `goal` 决策做状态机建模。这是五个仓库里唯一把 loop 决策形式化的做法，是[第 18 章 防死循环](../../book/03-policy-layer/ch18-loop-guards.md)的直接材料。
2. **无 OS 级沙箱，仅权限模式** —— 结论与 pi「宁可不给也不给半吊子」的立场（`packages/coding-agent/docs/security.md:35`）一致，但理由未必相同，需要分别取证再对照。
3. **`architecture-policy.yaml`** —— 自定义架构检查。与 `Step-Code` 的 16 道架构 lint 闸门是同类机制的两种独立实现，可直接对照（一个衍生方、一个自研方都做了这件事，是"标准解"的候选证据）。

### 两处取证时要小心的地方

- **文档滞后于代码**：`zcode-cua` 在文档里是 Computer Use 能力，运行时是 fail-closed 占位，直接返回 "Computer Use is not available in this build"。写作时按源码为准，并把这处作为方法论第一条的例子。
- **第三方归属**：`third-party/inventory.json` 将部分 skill 描述归属于 obra/superpowers，但实现已移除。清单与实际代码不一致，不能只读清单。

### 材料限制，必须在正文声明

3 个 squash commit 意味着**拿不到演进过程与设计讨论**。第 34 章能写"他们是怎么走到这一步的"，本章只能写"他们现在是什么样"。这个不对称要在第 35 章开头就交代清楚，不能让读者以为两个对照组的证据强度相同。

## 阻塞了哪些正文

- 第三部分（第 16–21 章）各章 `X.2` 表格的对照组行
- [第 35 章](../../book/06-vendors/ch35-zcode.md)、[第 36 章](../../book/06-vendors/ch36-comparison.md)、[第 37 章](../../book/06-vendors/ch37-lessons.md)
- [第 25 章 合规与审计边界](../../book/04-shipping/ch25-compliance.md)（它是唯一 Apache-2.0，与另四家的 MIT 在专利条款与 NOTICE 义务上不同）

产出流程见 [CONTRIBUTING](../../CONTRIBUTING.md#研究底稿的产出流程)。
