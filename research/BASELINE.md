# 研究基准

本书所有代码引用、行号、规模数字都基于下表锁定的版本快照。

**任何一处 `file.ts:123` 形式的引用，指的都是这张表里的那个 commit，而不是各仓库的当前 HEAD。**

---

## 为什么必须锁版本

pi 的提交节奏是**每月 400–530 次**，约每天 15 次。一个今天准确的行号，三周后大概率已经偏移。下游各仓库的节奏同样不慢。

所以本书采取的做法是：

1. 研究在**锁定的 commit** 上进行；
2. 结论写进 `research/<repo>/` 时附带该 commit；
3. 书正文引用 `research/`，**不直接引用活仓库**；
4. 升级基准时，整份重新核对，而不是局部打补丁。

代价是书会落后于上游。收益是**书里的每一条都能被复现**——读者 checkout 同一个 commit 就能看到同样的代码。对一本讲工程判断的书，可复现比时效重要。

---

## 版本表

| 仓库 | 厂商 | commit | 日期 | 版本 | License |
| --- | --- | --- | --- | --- | --- |
| **`pi`** | earendil-works | `b79e4cc834970cca69daebffab7df1da7d1e52c4` | 2026-08-28 | 0.84.4 | MIT |
| `Step-Code` | 阶跃星辰（公开） | `7dd66cb9f11a40ba19285b620084b362892cadea` | 2026-09-24 | 0.1.0 | MIT |
| `minimax-code` | MiniMax | `89c930a2dfb52ccebf937c2a0248512c1051be50` | 2026-09-21 | 0.5.0 | MIT |
| `kimi-code` | 月之暗面 | `65ae3e368c7cfa096242cacc12eeeb661e682977` | 2026-09-20 | 2.0.2 | MIT |
| `deepseek-harness`（对照组） | DeepSeek | `21638c56315ae6a2b552d6091945d3144c9af32e` | 2026-09-27 | 0.1.7-rc.2 | MIT |
| `ZCode`（对照组） | 智谱 Z.ai | `29628c9acdb81b703bbd4080c207a0e7ce5e276e` | 2026-09-23 | 3.14.3 | Apache-2.0 |

基准建立日期：**2026-09-28**。

### 复现方式

```bash
git clone https://github.com/earendil-works/pi-mono.git pi
git -C pi checkout b79e4cc834970cca69daebffab7df1da7d1e52c4
```

其余仓库同理，commit 见上表。

---

## 血缘：谁和 pi 是什么关系

这张图是第三部分与第六部分的全部前提。**必须先区分「代码衍生」与「无功能依赖」**——两者的分析含义完全不同。

```
A. 代码衍生（分析时须先与 pi 做 diff）
pi (earendil-works, MIT, v0.84.4)
├── Step-Code       ── 重构式衍生（包重命名为 @step-harness/*）       [阶跃·开源]
├── minimax-code    ── vendor 完整 pi 栈（third_party/pi-mono）
└── kimi-code       ── 仅 vendor TUI（@moonshot-ai/pi-tui）

B. 无功能依赖（两个独立对照组）
deepseek-harness   ── 自研内核。与 pi 的唯一接触点是一个默认休眠的
                      可选第三方 provider 适配器，不在自家模型路径上
ZCode              ── 零接触
```

**关于 `deepseek-harness`：它不使用 pi。** `@earendil-works/pi-ai@^0.85.1` 在全仓只出现于一处 `package.json`（`packages/llm/llm-pi-ai/package.json:47`）。该包自称 "design-verification twin of dsh-llm-deepseek"，在 `packages/bundle/base/cordis.patch.yml:123-128` 以**默认休眠**方式挂载——注释明言"零路由、模型选择器里不多出条目，直到 `llm-pi-ai:` 配置段提供 provider profile"。DeepSeek 自己的模型路径走 `llm-deepseek` / `llm-deepseek-account`（同文件 `:525-529`），`@deepseek-ai/dsh-llm-deepseek` 的依赖里没有任何 pi 包。`apps/cli` 与 `packages/core/agent-loop` 只在 `devDependencies` 中引用它，跨包源码引用仅一处测试（`packages/core/agent-loop/tests/system-prompt-admission.spec.ts:6`）。

【推断】它存在的目的是证明自家 LLM 接缝与 provider 无关——一个"接第三方模型"的可选能力，而非对上游的依赖。

| 仓库 | derivation 程度 | 署名是否保留 |
| --- | --- | --- |
| `Step-Code` | 重构式衍生 | ✅ `LICENSE-STATUS.md` 显式声明 |
| `minimax-code` | 整栈 vendor | ✅ `docs/architecture.md` + `LICENSE-STATUS.md` |
| `kimi-code` | 仅 TUI | ✅ `packages/pi-tui/LICENSE` 保留原作者署名 |
| `deepseek-harness` | **无功能依赖**（唯一接触点为可选休眠插件） | 不适用 |
| `ZCode` | 无关 | 不适用 |

**为什么留两个对照组**：`deepseek-harness` 与 `ZCode` 都是自研内核的中国厂商 Code Agent。当三家衍生方的选择趋同时，对照组能告诉我们"这是 pi 的路径依赖，还是这个问题本来就只有这一种解法"。两者的对照角度不同：`deepseek-harness` 走到了插件化的另一个极端（Cordis DI 容器 + 315 个包），`ZCode` 则是与 pi 完全无交集的独立演化。它们是本书的**对照组**，不是"用 pi 的厂商"。


---

## pi 规模速览

| 维度 | 值 |
| --- | --- |
| 源码 | **123,629 行 / 540 文件 / 10 个 workspace 包**（不含 test） |
| 测试 | 472 个文件 / 约 115,921 行 |
| 内核 | `packages/agent/src/agent-loop.ts` **794 行纯函数** |
| 产品层 | `packages/coding-agent` 60,960 行 / 206 文件（占 49%） |
| 运行时依赖 | 20 个，去掉 5 个自家包 = **15 个第三方** |
| Provider | **40 个**，其中中国厂商 16 个条目 / 7 家 |
| Git | 5,825 commit / 297 贡献者，2025-08-09 起 |

完整拆解见 [`pi/`](./pi/)。

### 行数怎么量

正文里的「X 行」若指一个包或一个目录的源码规模，统一用下面的过滤：只算 git 跟踪的 `.ts`/`.tsx`，路径须含 `/src/`，排除测试（`*.test.*`、`*.spec.*`、`test/`、`tests/`）和 `examples/`。

```bash
git ls-files '<pkg>' | grep -Ei '\.(ts|tsx)$' | grep -v '\.test\.\|\.spec\.' \
  | grep -vE '(^|/)tests?/' | grep -v '/examples/' | grep -E '/src/' \
  | tr '\n' '\0' | xargs -0 wc -l | awk '$2!="total"{s+=$1} END{print s}'
```

单个文件的行数直接用 `wc -l`。

---

## 升级基准的流程

当需要把基准推进到新版本时：

1. 更新本表的 commit 与日期；
2. **整份重新核对** `research/<repo>/` 的行号，不做局部修补；
3. 在本文件底部追加一条变更记录；
4. 书正文中受影响的章节逐一复核。

> ⚠️ 不要出现"书里一半引用旧基准、一半引用新基准"的状态。宁可延后升级，也不要混用——混用之后没有人能判断某一条是不是还成立。

### 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-01 | 更正 `deepseek-harness` 的血缘归类 | 原列为「库依赖」并称 pi-ai「打进发行包」。核实后更正为**无功能依赖**：唯一接触点是默认休眠的可选第三方 provider 适配器，不在 DeepSeek 自家模型路径上。它与 `ZCode` 同为对照组 |
| 2026-09-28 | 建立初始基准 | pi v0.84.4 + 三家衍生方 + 两个对照组 |
