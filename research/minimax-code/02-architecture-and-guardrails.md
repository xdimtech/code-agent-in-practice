# 2. 架构分层与守卫体系

> 对照基准：[pi 第 2 章](../pi/02-architecture-and-guardrails.md)。pi 的包图「只有三层深」；minimax-code 把 pi 的四个包整个压到了最底层，上面另起了五六层。

## 2.1 包结构：pi 沉到最底下

【文档】`docs/architecture.md:3` 的调用链：

```text
TUI / exec / ACP → CliService → local Applications → Session / Turn / Agent services → Pi / model providers / local tools
```

落到包上：

| 层 | 包 | 来自 pi？ |
| --- | --- | --- |
| 入口 | `packages/tui`（TUI、headless、ACP） | 终端引擎是 pi-tui 的 fork（2.5） |
| 产品入口 | `local-runtime-v2/src/local` | 自有 |
| 应用 | `local-runtime-v2/src/application`（18,857 行） | 自有 |
| 服务 | `local-runtime-v2/src/service`（149,821 行；最大的是 turn-system 41,359、session-system 33,463、plugin-system 17,563） | 自有 |
| 基础设施 | `local-runtime-v2/src/infra`（20,605 行）+ 复用的 `local-runtime` | 自有 |
| 领域模块 | `agent-modules/*`（12 个）+ `agent-extension`（9-hook 适配器） | 自有 |
| 组装 | `agent-core/src/pi-turn-runner/`（18 个文件 / 5,893 行） | 自有，**pi 从这里进来** |
| 引擎 | `third_party/pi-mono/packages/{agent,ai,coding-agent,tui}` | vendor 的 pi v0.79.1 |

【代码事实】`agent-core/src/pi-turn-runner/index.ts:1-12` 把自己叫「injection + assembly」层：「It does not implement `runAgentLoop()` itself (that ships in `@earendil-works/pi-agent-core`); it wires the pi runtime to explicit per-turn model / event writer / tool contracts supplied by runtime adapters.」

pi 的 L1（`agent-loop.ts`）和 L2（`Agent`）在用；**L3 `AgentSession` 和 `SessionManager` 没有任何一处 import**。会话、队列、历史、压缩、权限都在 `local-runtime-v2` 里重写了。

### 从 pi 拿了什么

【代码事实】按 import 统计（非测试文件）：

| vendor 包 | import 它的自有文件 | 拿的是什么 |
| --- | ---: | --- |
| `pi-agent-core`（`agent`） | 86 | `Agent`、`AgentMessage`、`AgentTool` 等循环与类型 |
| `pi-ai`（`ai`） | 56 | provider 适配、`Model`、`Usage`、流式事件 |
| `pi-coding-agent` | 19 | 零件：`convertToLlm`（3）、`AuthStorage`（3）、`DEFAULT_COMPACTION_SETTINGS`（2）、`createLocalBashOperations`（2）、`BashOperations` / `EditOperations` / `WriteOperations` 类型、`createBashTool`、`calculateContextTokens`、`resizeImage`、`getShellConfig` |
| `pi-tui` | 0 | 没人用 vendor 的这一份；产品用的是 `tui/src/tui/engine/` 里的 fork |

【推断】`pi-coding-agent` 在这里的角色是「工具箱」：拿它的消息转换、bash 执行、压缩默认值，不拿它的会话和扩展系统。这和 Step-Code 恰好相反——Step-Code 的产品层全部挂在 `coding-agent` 的扩展点上。

### 两代运行时

【代码事实】`local-runtime`（v1，138,172 行）和 `local-runtime-v2`（195,133 行）同时存在。`docs/architecture.md:9` 说 v1「supplies reused host facilities such as databases, file tools, permissions, and storage」，旧 reader 只读旧会话文件，「do not proxy to a daemon or fall back to a legacy executor」。v2 里有 13 个非测试文件 import `@mavis/local-runtime`。

权限 facade（`local-runtime/src/permissions/facade.ts`，1,410 行）、rm 垫片（`local-runtime/src/infra/ensure-rm-shim.ts`）、SQLite（`local-runtime/src/persistence/db.ts`）都还在 v1 里，被 v2 复用。

## 2.2 vendor 的 pi：改了多少

【代码事实】`third_party/pi-mono/.minimax-vendor.json`：上游 `refs/tags/v0.79.1`、commit `28df940f`，2026-06-16 导入，`"strategy": "source-vendor"`，`"localChangeLog": "MINIMAX_CHANGES.md"`。

把 vendor 的四个包与 pi v0.79.1 同名文件逐个比：

| 包 | 同路径 | 字节相同 | 改过 | 只在 minimax |
| --- | ---: | ---: | ---: | ---: |
| `agent` | 25 | 22 | 3 | 0 |
| `ai` | 54 | 31 | 23 | 1 |
| `coding-agent` | 155 | 138 | 17 | 1 |
| `tui` | 27 | 25 | 2 | 0 |

216 个文件 / 61,348 行与上游字节相同。`agent` 包的三个改动文件是 `agent-loop.ts`（742 → 877 行）、`agent.ts`（557 → 579）、`types.ts`（418 → 431），合计 +194 / −24 行，全部是给宿主开的控制接缝（第 3 章）。`ai` 的 23 个改动多是 provider 兼容（Mistral 的 system 角色、注入 fetch、流事件暴露等）。

### 补丁台账

【文档】`third_party/pi-mono/MINIMAX_CHANGES.md`（332 行）开头写「vendors `pi-mono` as source so MiniMax can patch, validate, and ship agent-loop fixes without waiting on upstream release cadence」。台账 38 条（37 个 `###` 条目，外加 `:328` 一条误用了 `##` 级标题的「2026-09-08: Explicit steering batches」）。

每条写原因、涉及的包、改动、是「通用的上游材料」还是「MiniMax 专用胶水」、验证命令、`Upstream PR`。`Upstream PR` 一栏的取值：

| 取值 | 条数 |
| --- | ---: |
| not opened.（含 not created. / not opened during the spike.） | 34 |
| not opened; the generic behavior is already upstream. | 1 |
| already merged as #6457（反向移植） | 1 |

这份台账的完整分析在[第 24 章](../../book/04-shipping/ch24-upstream-strategy.md)。

### 两处小的不一致

- 【代码事实】`.minimax-vendor.json` 的 `"policy": "../AGENTS.md"` 相对 `third_party/pi-mono/` 指向 `third_party/AGENTS.md`，这个文件不存在；真正的 `AGENTS.md` 在仓库根，是 `../../AGENTS.md`。
- 【代码事实】`:328` 那一条的标题层级与其余 37 条不同，机器按 `###` 解析会漏掉它。

## 2.3 守卫：一条 `pnpm verify`，14 道门

【代码事实】`scripts/verify.mjs:38-72` 是全部闸门的单一入口：

| 闸门 | 查什么 | 平台 |
| --- | --- | --- |
| `check:source` | 源码清单、根许可的 sha256、内部地址、已退役模块、明显的凭据、workspace 导出 | 全部（含 docs profile） |
| `check:tsconfig` | 生成的路径映射 | 全部 |
| export source preview | 无历史的源码导出 | 全部 |
| `test:release-tools` | 发布工具自身 | 全部 |
| `typecheck` | 全仓类型检查 | 只在一个 Linux job（`:48-50` 注释：编译输入跨平台相同） |
| `build` | 构建 | 全部 |
| `check:standalone` | 构建产物的依赖图 | 全部 |
| `test:artifact` | 打包产物 | 全部 |
| `test:capabilities` | 能力测试（Vitest） | 全部 |
| `test:status-contract` | 状态协议 | 全部 |
| `test:smoke` | CLI / ACP 冒烟 | 全部 |
| `test:byok` | 离线 BYOK | 全部 |
| `test:policy` | 权限 facade | darwin / linux（`:58` 注释：用了 POSIX 进程与文件语义） |
| `test:sandbox` | Seatbelt 沙箱 | 只有 darwin |
| `test:release-package` | 发布包 | 只在打包时 |

【文档】`docs/verification.md:31` 记录了一次全部通过：「`pnpm verify` passed all 14 gates on macOS arm64, Node.js 26.4.0 and pnpm 9.12.0」，并列出每道门的测试数（capabilities 2,679 个，policy 115 个，sandbox 48 个）。

### 两份「退役清单」，两个检查器

【代码事实】`scripts/lib/retired-sources.mjs:1-6` 的注释把两种检查分得很清楚：

> `check:source` inspects the files that exist in this repository, while `check:standalone` inspects the input graph of the produced bundle. A path therefore belongs to exactly one of the two sets below.

- `retiredSourceRoots`（`:9-24`）：不允许作为公开源码存在——例如 `agent-modules/team/`、两个 `thrift-gen` 包、`local-runtime/src/http/`、`local-runtime-v2/src/service/session-handoff/`。
- `nonBundledSources`（`:28-30`）：可以存在，但不能进构建产物。

`scripts/check-standalone-boundary.mjs:11-24` 还反过来查一件事：一组**必须**出现在产物里的文件（登录、更新、插件客户端、联网搜索、权限云端网关客户端……），缺了就失败。【推断】这是一个公开投影特有的风险：裁剪内部代码时把产品必需的能力一起裁掉了，类型检查和单测都可能照常通过。

### 测试只跑了一部分

【代码事实】仓库里有 425 个 `*.test.ts(x)`；`test/vitest-suites.json` 声明会跑的是 156 个（capability 152、sandbox 2、status-contract 1、policy 1）。`AGENTS.md` 的 Layout 一节说 `test/vitest-suites.json` 是「the declaration of every Vitest file this distribution runs」，`third_party/` 下的上游测试「are not part of this distribution's verification」。另外 269 个测试文件在仓库里，但不在任何一个闸门里。

### 没有的

- **没有包之间的分层闸门。** 架构文档写了每一层的职责，但没有一个像 Step-Code `check-layer-direction.mjs` 那样的 AST 检查；v2 → v1 的 13 处 import 也没有白名单约束。【代码事实】`scripts/` 下没有这类脚本；全仓也没有 dependency-cruiser、eslint 的 `no-restricted-imports` 之类配置。
- **终端引擎的 import 边界只有约定。** `tui/src/tui/engine/UPSTREAM.md` 写「Product code may only import `public.ts`; direct imports into implementation files are forbidden」。【代码事实】产品源码里确实没有违反它的 import（测试文件有），但找不到执行这条规则的脚本。

## 2.4 供应链与 CI

【代码事实】

- 所有 Action 钉到 commit SHA（例如 `.github/workflows/ci.yml:19`、`compatibility.yml:27-29`）。
- 安装一律 `pnpm install --frozen-lockfile`。
- `security.yml:26-29` 用 gitleaks 扫**完整历史**（`--log-opts=--all`）和 `git archive HEAD` 出来的源码快照，`:45` 再扫一遍构建产物 `dist`。
- 根 `package.json` 用 overrides 钉住有漏洞的传递依赖（`docs/verification.md` 的 2026-09-18 一节：Vitest 4.1.11、Vite 7.3.6、Hono 4.13.5、fast-uri 3.1.6）。
- CI 矩阵是 ubuntu + macos、Node 24；`ci.yml:58` 注释「Windows validation is temporarily paused until its checks are reliable」。

pi 的 `check:pinned-deps`、`check:shrinkwrap` 这类针对 npm 发布物的门，minimax 没有对应物——它的 workspace 包都是 `private: true`（`docs/open-source-status.md`：「Workspace and local-build manifests remain `private: true` to prevent accidental npm publication」）。

## 2.5 第二份 pi：终端引擎 fork

【文档】`packages/tui/src/tui/engine/UPSTREAM.md`：

- 上游是 pi 仓库 `packages/tui/src`，commit `836aee6d`，版本 0.84.2，2026-08-18 导入，08-19 建立 fork；
- 「This directory is MCode-owned source … Pi is provenance and a future selective-sync input, not a runtime boundary.」
- 0.84.4 的几处修复是挑着合进来的，记作本地差异 L017–L021，「this is not a claim that the whole Engine snapshot has moved to `0.84.4`」。

【代码事实】`BASELINE.json` 存了每个文件的上游 hash 和适配后 hash（39 个源文件）；`LOCAL_CHANGES.md` 是一张 28 行的差异表（L001–L030，编号不连续），每行写范围、改动、行为影响、证据。`tui/test/unit/tui-engine-local-deltas.test.ts` 专门测这些差异。

所以这个仓库里有**两份不同版本的 pi**：`third_party/pi-mono` 是 v0.79.1（agent、ai、coding-agent 在用，tui 没人用），`tui/src/tui/engine/` 是 0.84.2 加挑选的 0.84.4 修复。两份各有一本台账，格式不同：前者按日期写段落，后者是一张带编号的表。

## 2.6 公开投影的代价

【文档】`AGENTS.md:3`：「upstream changes arrive through a three-way merge … Moving or renaming files therefore has a cost that a normal repository does not have: it shows up as a conflict or an unreviewed new file at the next synchronization. Prefer changing content over changing layout.」

【代码事实】`release/public-source.json` 列出每一个发布的文件；`release/extraction.json` 钉住内部基线 `9b9885e4`、31 个包根和产品基线 `0.4.12`。新增文件必须显式更新清单（`docs/architecture.md:16`：「absence from the bundle alone does not make source suitable for publication」）。

这套机制解释了几个后面会看到的现象：`agent-core` 三个文件头 `@see packages/agent-core/ARCHITECTURE.md`（如 `pi-turn-runner/index.ts:16`），这个文件不在仓库里（第 3 章）；`embedded harness`、`ContextManager` 类等没有调用方的代码还留着（第 4、7 章）；版本号在文档和 manifest 里不一致（第 8 章）。

## 2.7 本章结论

- pi 在最底层，是一个库：用它的循环、provider、若干零件；不用它的会话、扩展系统、vendor 进来的 tui。
- vendor 补丁小而集中：`agent` 包 +194 / −24 行，全部是控制接缝；台账 38 条，只有 1 条到过上游。
- 守卫集中在「公开投影会出什么错」：内部地址、退役模块、必需能力是否在产物里、许可文本、全历史密钥扫描。
- 没有包分层闸门；测试只跑了 425 个里的 156 个。
- 两份不同版本的 pi 并存，各自有台账。
