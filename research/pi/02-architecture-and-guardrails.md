# 2. 架构分层与守卫体系

## 2.1 包依赖：只有三层深

pi 是 10 个 npm workspace。按 `package.json` 的 `dependencies` 实际声明整理（不是按目录名想象）：

```
L0  telemetry        (无内部依赖)
    tui              (仅 get-east-asian-width / marked)
    protocol         (仅 typebox)

L1  ai        → telemetry
    client    → protocol

L2  agent     → ai + telemetry
    server    → ai + protocol

L3  session-backends/sqlite-node  → ai + agent
    coding-agent                  → agent + ai + client + protocol + tui

L4  evals     → ai + coding-agent   (devDependencies，private: true)
```

证据：`packages/ai/package.json:65`、`packages/client/package.json:50`、`packages/agent/package.json:38-39`、`packages/server/package.json:50-51`、`packages/session-backends/sqlite-node/package.json:37-38`、`packages/coding-agent/package.json:47-51`、`packages/evals/package.json:12-13`。

两个值得注意的事实：

- **`coding-agent` 不依赖 `server` 和 `sqlite-node`**。产品 CLI 是纯本地的；`server`/`client`/`protocol` 那条链是另一套东西（远程会话），在 CLI 里没接。
- **底层包不回指上层**：在 `packages/agent`、`packages/ai` 里 grep `pi-client|pi-protocol|pi-tui|pi-server`，零命中。分层方向是真的。

### build 顺序不是分层规范

根 `package.json:16` 的串行 build 顺序是 tui → telemetry → ai → agent → sqlite-node → protocol → client → server → coding-agent。

拓扑合法，但**不是最小拓扑**：`protocol` 无任何依赖却排第 6，`sqlite-node` 是叶子却排第 5。**推断**：这是历史增量追加的产物。读架构时不要把它当分层声明——真实分层只有三层深。

---

## 2.2 没有机器强制的架构规则

**代码事实**：grep `depcruise|dependency-cruiser|madge|eslint-plugin-boundaries`，全仓零命中。

`biome.json:3-25` 只有 formatter + recommended lint，没有导入边界规则。

分层的实际保证只剩三条：

1. `packages/*/package.json` 的 `dependencies` 字段本身——npm workspaces 不会解析未声明的包，这是最硬的一道；
2. 根 `tsconfig.json:9-35` 的 `paths` 映射——但它把**所有**包映射给了所有代码，**反而不构成隔离**，只是让 IDE 能跳转；
3. 人工 + `AGENTS.md` 约定。

> 对比：Step-Code 有 16 道架构 lint 闸门（`check-public-boundary`、`check-layer-direction` 等），step-cli 有 13 条 depcruise 规则。**这是下游厂商在 pi 基座上明确补强的方向**，不是他们抄来的。

pi 选择不做这件事是可以理解的——10 个包、三层深、依赖边清晰，靠 package.json 就够了。但这意味着**它的分层纪律随包数增长会线性劣化**，而下游 fork 后包数都涨了。

---

## 2.3 五道 `check:*` 闸门

`npm run check`（`package.json:18`）= biome(`--error-on-warnings`) → pinned-deps → ts-imports → shrinkwrap → install-lock → `tsgo --noEmit` → browser-smoke。

其中五道是 pi 自己写的脚本，每一道都对着一个具体的失败模式：

### `check:pinned-deps`

`scripts/check-pinned-deps.mjs:5,52-55`。递归扫所有 package.json，外部 registry 依赖**必须是精确 semver**——`^`、`~`、range 全部报错。内部 `@earendil-works/pi-*` 与非 registry specifier 豁免。

防的是：同一 commit 在不同时间装出不同的依赖树。

### `check:ts-imports`

`scripts/check-ts-relative-imports.mjs:24,42`。用 TS AST 遍历 import / export / 动态 import / `import type`，**禁止相对导入写 `.js` 后缀**，要求写 `./foo.ts`。

动机链条是完整的，值得单独说：

1. `tsconfig.base.json:18-19` 开了 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`；
2. `AGENTS.md:23` 要求"只用可擦除语法（Node strip-only 模式）"——不许 `enum`、`namespace`、参数属性等需要 JS emit 的构造；
3. 二者合起来，`node src/cli.ts` 或 `bun src/cli.ts` 能**直接跑未编译的源码**。因为 Node 的 type-stripping 只擦类型、不做路径重写，所以源码里的相对导入必须写运行时真实存在的路径，也就是 `.ts`；
4. `tsc` 在 emit 时再把 `.ts` 改回 `.js`。

`scripts/update-source-imports-to-ts.sh:5-6` 的注释就是这段说明。

**这是 pi 工程风格的一个缩影**：为了"源码能直接跑"这一个属性，付出了三处配置 + 一道 CI 闸门 + 一条语法禁令的代价。

### `check:shrinkwrap`

`scripts/generate-coding-agent-shrinkwrap.mjs`。从根 lockfile 派生 `packages/coding-agent/npm-shrinkwrap.json`（随包发布，见 `packages/coding-agent/package.json:44`），`--check` 比对漂移。

校验项：拒绝 `link:`/`file:`/`workspace:` 本地 resolved（`:236-239`）、依赖闭包完整（`:268-276`）、必须有平台特定 optional 条目（`:279`）。

### `check:install-lock:coding-agent`

`scripts/generate-coding-agent-install-lock.mjs`。生成一个独立 installer 包 `@earendil-works/pi-coding-agent-install` 的 package.json + lockfile，额外校验 dev/extraneous 元数据（`:293`）与内部包版本 lockstep（`:296-298`）。

这对产物作为 release asset 上传（`.github/workflows/build-binaries.yml:88-89`）并推到 R2，供 `pi update --self` 与 installer API 做可重现安装。

### `check:browser-smoke`

`scripts/check-browser-smoke.mjs`。用 esbuild 打 browser target 两个 entry。第二个 entry 是**tree-shaking 断言**：

- 禁止 `compat.ts` / `models.generated.ts` / `providers/all.ts` 进入 bundle（`:66-75`）
- 目录 JSON 只能含 `anthropic.json`（`:87`）
- SDK 只能含 `@anthropic-ai/sdk`（`:100-108`）

防的是：一次误加的 barrel import 静默把整个模型目录和 5 个 provider SDK 拖进包，"按需引入单个 provider"的能力就没了。

**这是一道用 bundle 产物内容做断言的闸门，同类项目少见。** 它防的不是"能不能编译"，是"能力有没有被悄悄破坏"。

---

## 2.4 供应链安全：层层设防

pi 在这方面的强度在同类 OSS 里罕见。全链条（均为代码事实）：

| 环节 | 措施 | 位置 |
| --- | --- | --- |
| 声明 | 外部依赖精确版本 | `scripts/check-pinned-deps.mjs` |
| 安装 | `npm ci --ignore-scripts` | `ci.yml:33`、`npm-audit.yml:25`、`build-binaries.yml:327` |
| lifecycle script | **显式 allowlist**，且 allowlist 项过期会报错要求删除 | `generate-coding-agent-shrinkwrap.mjs:13-16, 257-261` |
| 发布 | `npm publish --provenance --ignore-scripts` | `scripts/publish.mjs:108` |
| 持续监控 | 每日 `npm audit --omit=dev --audit-level=moderate` + `npm audit signatures` | `npm-audit.yml:28-31` |
| 提交 | pre-commit **默认拒绝**任何 `package-lock.json` 提交 | `scripts/check-lockfile-commit.mjs:5-6, 92-95, 119` |

最后一条细看：只有纯 workspace 元数据变更放行，否则必须 `PI_ALLOW_LOCKFILE_CHANGE=1`。拒绝时会打印新增/升级包清单，并提示检查 "npm age gate / 新 lifecycle script"（`:100-103`）。

防的是三件事：typosquat 与劫持版本的自动漂移、postinstall 任意代码执行、以及**"lockfile 混在大 PR 里没人看"**——这是 npm 供应链最常见的入口。

**推断**：这套强度的动机很直白——pi 本身是一个能执行 bash 的 coding agent，供应链失守等于用户机器上的 RCE。把自己的依赖当作攻击面来管，是正确的威胁建模。

> ⚠️ **但这套严格只对 pi 自己**。用户安装的扩展包走的是另一条路，`getNpmInstallArgs`（`packages/coding-agent/src/core/package-manager.ts:1785-1806`）**没有 `--ignore-scripts`**。详见[第 7 章](./07-extensibility.md)——这是本次拆解发现的最主要的不一致。

---

## 2.5 CI 与贡献者闸门

### 贡献者准入是自动化的

三个 workflow 组成一套准入机制：

- **`issue-gate.yml`**：新 issue 若作者非 write+ 协作者、且不在 `.github/APPROVED_CONTRIBUTORS`，则评论 + 打 `untriaged` + 关闭为 `not_planned`（`:109-129`）。
- **`pr-gate.yml`**：同样逻辑但更严——只有 capability 为 `pr` 的人能开 PR（`:111-114`），否则评论关闭（`:85-99`）。用 `pull_request_target`（`:5`），因此**不 checkout PR 代码**，没有 fork 提权面。
- **`approve-contributor.yml`**：维护者在 issue 评论里写 `lgtmi`（授予 issue）或 `lgtm`（授予 issue + pr），正则要求出现在开头或结尾（`:33-34,43`），校验评论者 write 权限（`:52`），然后**直接 commit & push** 更新 `APPROVED_CONTRIBUTORS`（`:181-183`）。

三者共享 `TRUSTED_BOT_AUTHORS = dependabot/sentry/claude`（`issue-gate.yml:20`）。

**这是一个默认关闭、显式开放的开源项目。** 297 位贡献者、5,825 commit 的数字要在这个背景下读——不是"社区涌入"，是"逐个放行"。

### workflow 本身的安全

- 所有 action 用 **commit SHA 固定**（`ci.yml:18,21`），不是 tag。
- `build-binaries.yml:18` 顶层 `permissions: {}`，逐 job 最小授权。

---

## 2.6 发布：一条有顺序约束的流水线

### lockstep 版本

`scripts/publish.mjs:70-73` 硬性要求所有公开包版本完全一致，否则抛错。`scripts/release.mjs:12` 先验证每个包已在 npm 注册——**防首发被抢注**。

### 双通道

1. **bun 单文件二进制**：从**源码归档**重建（`build-binaries.yml:66-76`），`--offline-model-data` 保证可重现；6 平台产物 + SHA256SUMS。
2. **npm**：OIDC trusted publishing（`build-binaries.yml:301-302` `id-token: write`，`:338-340` 升级到 npm 11.16.0），无需本地 `npm publish`、OTP 或 WebAuthn。

### job 顺序及其理由

```
build → smoke-test-binaries → stage-github-release(draft) → publish-npm
      → announce-pi-dev-release → publish-github-release(转公开)
                ↓ 任一环失败
        cleanup-draft-github-release(删 draft)
```

`smoke-test-binaries` 在三平台跑 `--help` / `--version`；`stage-github-release` 建的是 **draft**（`:280-285`），最后一步才转公开（`:415`）；失败则删除（`:425`）。

**为什么 `publish-npm` 必须在 `announce` 之前**——这是整条流水线里唯一一处有硬因果的顺序约束：

`scripts/publish-release-announcement.mjs:105-127` 会轮询 npm registry，逐包 fetch metadata + HEAD tarball、校验 `dist.integrity`，全部可用才写 R2。R2 的 `releases/v1/latest.json` 与 `installer/v1/latest.json` 用 ETag 条件写做 CAS 单调推进（`:255-266` `advanceLatestRelease`，**绝不回退版本**）。

而客户端的版本检查（`packages/coding-agent/src/utils/version-child/version-check.ts:5`）读的正是 `pi.dev/api/latest-version` → 这个 marker。

**顺序倒置的后果**：客户端会被告知一个 npm 上还不存在的版本，`pi update --self` 直接失败。GitHub Release 放在最后公开，保证"三处可见版本"不早于"三处可安装"。

---

## 2.7 测试：472 个文件，11.6 万行

### 规模与分布

| 包 | test 文件数 |
| --- | ---: |
| coding-agent | 246 |
| ai | 137 |
| tui | 33 |
| agent | 23 |
| sqlite-node | 11 |
| server | 7 |
| client | 6 |
| protocol | 3 |
| telemetry | 2 |

合计 472 个 `*.test.ts`（另有 scripts 下的 `.test.mjs`），约 **115,921 行**。

### 分层

- `packages/coding-agent/test/` 根目录 154 个 = 遗留 unit 层；
- `test/suite/` = 新的 harness 层，9 个 + `suite/regressions/` 下 **71 个按 GitHub issue 编号命名**的回归用例（如 `6768-copilot-compaction-base-url.test.ts`）。issue 号进文件名，`AGENTS.md` 也要求测试里加 issue 注释——**缺陷到用例的映射是强制的**；
- `packages/agent` 另有独立的 `vitest.harness.config.ts`，只跑 `test/harness/**` 并单独统计覆盖率（范围 `src/harness/**` + `src/agent.ts` + `src/agent-loop.ts`）——即[第 3 章 §3.9](./03-agent-loop.md) 说的 v2 有自己的质量门。

### 三道隔离措施

真实 API 测试靠 `describe.skipIf(!process.env.XXX_API_KEY)` 门控（如 `packages/ai/test/google-thinking-disable.test.ts:92,106,146,154`）——**有 key 就会打真实 API**。所以：

1. `AGENTS.md:33` 明令**禁止直接跑全量 vitest**，必须用 `./test.sh`。它用 `mktemp -d` 造隔离的 HOME/TMPDIR/XDG，并从**空环境**按白名单重建 env（`test.sh:40-62`），API key 自然被剥离。
2. coding-agent 默认离网：`vitest.config.ts` 设 `env: { PI_OFFLINE: "1" }`，需要网络的测试必须显式调 `allowNetwork()`（`test/test-network-env.ts:4-6`，本质是 `vi.stubEnv("PI_OFFLINE", undefined)`）。
3. **faux provider**：`packages/ai/src/providers/faux.ts` 提供假 LLM provider（`fauxProvider()` `:685`，配 `fauxText`/`fauxThinking`/`fauxToolCall`/`fauxAssistantMessage` 构造器 `:52-76`，可 `setResponses()` 预排队，还支持 deferred response 做并发时序测试 `:585`），从 `packages/ai/src/index.ts:36` 导出。`test/suite/README.md:5-10` 规定 suite 层必须用它，禁止真实 API / key / 付费 token。

**这是"246 个 coding-agent 测试仍能在 CI 里确定性运行"的前提。** 一个能调真实 LLM 的项目，把"测试默认离网 + 假 provider + 环境白名单重建"三件事都做了，是同类项目里少见的完整。

---

## 2.8 本章结论

**pi 的工程纪律高度集中在两个地方：供应链，和"源码能直接跑"这个属性。** 前者有清晰的威胁建模（自己是 RCE 工具），后者是开发体验偏好，但两者都付出了真实的 CI 成本并坚持住了。

**它明确没做的是架构守卫。** 没有 depcruise、没有导入边界 lint，分层只靠 package.json 和人。在 10 包三层的规模下这是合理取舍，但它解释了为什么下游厂商（Step-Code 16 道闸门、step-cli 13 条 depcruise 规则）在 fork 之后第一件事就是补这个——**他们的包数都涨了，而 pi 的保证方式不随规模扩展**。

最值得抄的单点：`check:browser-smoke` 那种**对产物内容做断言**的闸门，和 `announce` 必须在 `publish-npm` 之后的**版本可见性单调约束**。两者都不是"检查代码对不对"，而是"检查某个能力/承诺有没有被悄悄破坏"。
