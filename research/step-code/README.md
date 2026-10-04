# Step-Code 拆解

> **这是研究底稿，不是本书正文。**
> 它是[第 31 章](../../book/06-vendors/ch31-step.md)和第三部分「各家的选择」的证据层。版本锁定见 [`../BASELINE.md`](../BASELINE.md)。

**状态**：✅ 完成（基准 `7dd66cb9`，对照 pi `b79e4cc8`）

| 项 | 值 |
| --- | --- |
| 厂商 | 阶跃星辰（公开仓库 `github.com/stepfun-ai/Step-Code`） |
| 基准 commit | `7dd66cb9f11a40ba19285b620084b362892cadea`（2026-09-24，合并 PR #189） |
| 版本 | 0.1.0（`packages/coding-agent/src/step/version.ts` 的 `STEPCODE_FALLBACK_VERSION`） |
| 许可 | MIT，`LICENSE` 同时保留 pi 作者与 Step Code 两行版权；`LICENSE-STATUS.md:3-7` 明说「derived from the MIT-licensed Pi project」 |
| 与 pi 的关系 | **重组式衍生**：拿 pi 一个快照重排包结构、裁掉 provider 与服务端，在 pi 的扩展点上叠一整层产品策略。见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |
| 历史 | 18 个提交，全部在 2026-09-22 ～ 09-24；首个提交 `4fdb781`「init stpe-code」一次加入 1,407 个文件——**pi 的提交历史没有带过来** |

本书关于阶跃星辰的分析**只以这个开源仓库为准**。

---

## 规模（统一口径）

两边用同一条命令量，不混用其它口径：

```bash
git ls-files -- 'packages/*' 'apps/*' | grep -E '\.tsx?$' \
  | grep -vE '\.test\.tsx?$|/test/|/tests/|/examples/|\.d\.ts$'
```

| 包 | pi 文件 / 行 | Step-Code 文件 / 行 | 去向 |
| --- | ---: | ---: | --- |
| `agent` → `agent-core` | 53 / 12,814 | 59 / 14,109 | 改名，加了请求期投影 |
| `ai` → `providers` | 184 / 27,301 | 73 / 15,536 | 改名，**内置 provider 清零** |
| `coding-agent` | 206 / 60,964 | 256 / 79,640 | 主战场：`step/` + `features/` |
| `tui` | 40 / 17,000 | 40 / 17,359 | 基本原样 |
| `telemetry` | 6 / 935 | 6 / 935 | 原样 |
| `protocol` → `contracts` | 9 / 1,245 | 9 / 479 | 重写成薄契约 |
| `config` | — | 2 / 360 | 新增 |
| `apps/cli` | — | 89 / 23,085 | 新增：入口 + 交互模式从 coding-agent 搬出 |
| `client` / `server` / `session-backends` / `evals` | 58 / 7,287 | — | **整包删除** |
| **合计** | **556 / 127,546** | **534 / 151,503** | +18.8% 行 |

测试文件：pi 472 个，Step-Code 490 个（同一路径前缀，`*.test.ts(x)`）。

> pi 底稿 README 里的 123,629 行 / 540 文件用的是另一种过滤（只算 `src/`），这里不混用；两份底稿各自口径内部一致。

## 与 pi 的 diff（按 blob hash，只看源码）

| 包对 | pi | Step | 同路径 | 字节相同 | 改过 | 只在 pi | 只在 Step |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coding-agent | 330 | 380 | 244 | 157 | 87 | 86 | 136 |
| agent → agent-core | 55 | 61 | 55 | 32 | 23 | 0 | 6 |
| ai → providers | 189 | 79 | 66 | 50 | 16 | 123 | 13 |
| tui | 43 | 43 | 43 | 23 | 20 | 0 | 0 |
| telemetry | 8 | 8 | 8 | 7 | 1 | 0 | 0 |
| protocol → contracts | 12 | 11 | 2 | 1 | 1 | — | — |

（这张表的口径是 `git ls-tree -r -z HEAD` 下各包 `src/` 的全部 `.ts/.tsx`，含包内测试，所以总数比上面的规模表大。）全仓 280 个 Step 文件与 pi 的**某个**文件字节相同（不论路径）。

**一句话**：循环、工具协议、审批 UI、扩展事件全部是 pi 的；Step-Code 自己的判断集中在 `packages/coding-agent/src/step/`（61 个文件）和 `packages/coding-agent/src/features/`（43 个文件：goal / cron / plan / tasks / subagent / workflow）。

## 9 章

| # | 文档 | 一句话结论 |
| --- | --- | --- |
| 1 | [产品定位与能力盘点](./01-product-teardown.md) | 单一 provider 的终端产品；pi 的「No X」清单 6 项全部补上 |
| 2 | [架构分层与守卫体系](./02-architecture-and-guardrails.md) | 18 个 `check-*.mjs`，14 个是新加的架构闸门，15 个带 `--self-test` |
| 3 | [Agent Loop](./03-agent-loop.md) | 循环只改一处：工具调用标记泄漏到文本时重采样，默认 2 次 |
| 4 | [上下文工程](./04-context-engineering.md) | 压缩预留 16384→24576；新增默认关闭的请求期投影（纯函数、三条不变量） |
| 5 | [工具面与权限](./05-tools-permissions.md) | 四档预设 + shell 静态分析三态；**无沙箱、无路径边界**，SDK 层显式拒绝 `sandbox.enabled` |
| 6 | [多 Agent 编排](./06-multi-agent.md) | 子 agent 变内置工具（rpc 子进程 + 可选 worktree）；workflow 跑在 QuickJS/WASM 里 |
| 7 | [扩展性与生态](./07-extensibility.md) | 扩展事件与 pi 完全一致（36 个）；新增 MCP、Claude Code / Codex 配置导入、声明式插件市场 |
| 8 | [可观测性](./08-observability.md) | 公开构建的遥测是**构造上的 no-op**；50 个事件只有契约没有实现 |
| 9 | [评估、风险与建议](./09-assessment-risks-recommendations.md) | 7 项发现 + 探针 A–H 全部答案 |

## 阻塞了哪些正文

- [第 31 章 阶跃星辰：Step-Code](../../book/06-vendors/ch31-step.md) —— 已解除
- 第三部分（第 16–21 章）的 `X.2 各家的选择` 中 Step-Code 一栏
- [第 6 章 成本与投入](../../book/01-choosing/ch06-cost-and-effort.md) 的 diff 规模

## 引用约定

- 路径一律写仓库内相对路径，行号对应基准 commit。
- 证据标签：**【代码事实】** 读源码得出；**【推断】** 由代码推出但没有直接陈述；**【文档】** 仓库自带文档或 README 的原话；**【实机】** 在 macOS arm64、Node v22.22.3 上跑出来的结果（只在 `git archive` 出来的副本里跑，不动原仓库）。
- Step-Code 的 npm scope 本书不写出，统一称「自家 scope」，包用目录路径指代。
