# 研究底稿（证据层）

> 基准：pi `b79e4cc8` (v0.84.4)　·　[版本表](./BASELINE.md)　·　[参与指南](../CONTRIBUTING.md)

**这里是正文的证据层，不是正文。** 全书每一处 `file.ts:123` 形式的引用，都指向这个目录下锁定 commit 的拆解稿；正文负责讲判断，这里负责给依据。

如果你在正文里看到一条结论想核实，路径是固定的三步：

1. 在本目录找到对应仓库的拆解稿；
2. 在 [`BASELINE.md`](./BASELINE.md) 查到该仓库锁定的 commit；
3. `git checkout` 那个 commit，按行号去看原文。

## 为什么要分成两层

一本讲工程判断的书有两种失败方式。一种是只讲判断，读者没法验证，那是评论而不是技术书。另一种是把证据全塞进正文，读者被行号淹没，看不出结论是什么。

所以拆开：正文里每条结论都短，证据层里每条证据都全。两层之间靠行号和 commit 连接。

这也意味着**两层的写作顺序不能倒**。拆解稿先完成，正文才能写——这就是为什么下表里「待完成」的仓库会阻塞正文的对应章节。

## 拆解进度

| 仓库 | 厂商 | 与 pi 的关系 | 状态 |
| --- | --- | --- | --- |
| [**pi**](./pi/) | earendil-works | **公共上游** | ✅ 完成（9 章） |
| [Step-Code](./step-code/) | 阶跃星辰（公开） | 代码衍生 · 重构式 | ⬜ 待开始 |
| [minimax-code](./minimax-code/) | MiniMax | 代码衍生 · 整栈 vendor | ⬜ 待开始 |
| [kimi-code](./kimi-code/) | 月之暗面 | 代码衍生 · 仅 TUI | ⬜ 待开始 |
| [deepseek-harness](./deepseek-harness/) | DeepSeek | **无功能依赖**（对照组） | ⬜ 待开始 |
| [ZCode](./zcode/) | 智谱 Z.ai | **零接触**（对照组） | ⬜ 待开始 |


## 每份拆解稿的固定结构

六个仓库沿用同一套 9 章框架。框架固定，才能横向比——不同结构的拆解稿没法放进同一张表。

| # | 章节 | 回答的问题 |
| --- | --- | --- |
| 1 | 产品定位与能力盘点 | 是什么、边界在哪 |
| 2 | 架构分层与守卫体系 | 依赖方向、横切关注点、机器强制的架构约束 |
| 3 | Agent Loop 深度拆解 | 主循环、steering、中断语义、防死循环、token 预算 |
| 4 | 上下文工程 | system prompt 构造、压缩管线、memory 层次 |
| 5 | 工具面、权限与 Code Mode | 内置工具、权限模型、沙箱 |
| 6 | 多 Agent 编排 | subagent 机制、模型绑定、隔离与可见性 |
| 7 | 扩展性与生态策略 | 插件、MCP、skill、SDK |
| 8 | 可观测性 | trace 采集与产品埋点 |
| 9 | 评估、风险与建议 | 工程判断：护城河与技术债 |

## 三条方法论规则

**一、以读源码为主，仓库自带文档为辅并交叉验证。**

厂商文档常滞后于代码，或把未实现的能力写成已实现。一个现成的例子：ZCode 的 `zcode-cua` 在文档里是 Computer Use 能力，运行时却是 fail-closed 占位，直接返回 `Computer Use is not available in this build`。

**二、每条结论可追到 `file:line`，并标注它是事实还是推断。**

> 【代码事实】`agent-loop.ts:252` 的 `shouldStopAfterTurn` 在 `packages/coding-agent/src/` 中零调用点。
>
> 【推断】这更像是遗漏而非设计——相邻的 `uncaughtException` 路径被仔细处理过。

事实可以被证伪，推断只能被质疑。混在一起写，读者就无法判断该信任到什么程度。

**三、pi 衍生仓库的第 2～6 章必须先与 pi 做 diff。**

否则会把上游的设计误判为本家的创新。这条**不适用于两个对照组**（`deepseek-harness`、`ZCode`）——它们与 pi 无功能依赖，没有 diff 可做，要做的是独立解法的平行记述。

## 测量口径

规模数字必须同一口径才能比较。全书统一为：

```bash
# .ts / .tsx，仅 src/ 目录下，排除测试与示例
git ls-files '<pkg>' \
  | grep -Ei '\.(ts|tsx)$' \
  | grep -v '\.test\.\|\.spec\.' \
  | grep -vE '(^|/)tests?/' \
  | grep -v '/examples/' \
  | grep -E '/src/' \
  | tr '\n' '\0' | xargs -0 wc -l \
  | awk '$2!="total"{s+=$1} END{print s}'
```

这条口径复现 pi `packages/coding-agent` 的 **206 文件 / 60,960 行**。换口径会得到完全不同的数字（同一个包，放宽到「全部 ts 含测试与示例」是 562 文件 / 129,215 行，是前者的两倍），所以**任何一处规模数字都必须用上面这一条**，不能混用。

## 产出与发布

拆解稿在研究工作区（`code-agents/docs/<slug>/`）成稿，定稿后**单向发布**进本目录，并在 [`BASELINE.md`](./BASELINE.md) 登记 commit 与日期。

单向意味着不在本目录直接改稿——发现问题回到上游改，再重新发布。完整流程见 [CONTRIBUTING](../CONTRIBUTING.md#研究底稿的产出流程)。
