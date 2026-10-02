# ch13-package-gate

对应 [第 13 章 打包与分发](../../book/02-getting-started/ch13-packaging.md)。

这个例子做两件事：

- **按 pi 的规则算出一个包会加载什么**：清单与约定目录二选一、过滤四步（普通 → `!` → `+` → `-`）、settings 过滤器、`autoload: false` 差量、五级优先级与同名先到先得、包身份去重
- **装之前先检查，装的时候加闸门**：列出安装时会执行的脚本、写错的依赖、被静默丢掉的清单字段；再按 pi 给自己装依赖的那套纪律——`--ignore-scripts` 安装、审 lockfile 里每个有安装脚本的包、只为白名单补跑——给第三方包也装一道闸门

规则部分全是纯函数，输入是包内文件的相对路径列表；只有 `src/load.ts` 读磁盘，而且不跟随符号链接。不连网络、不真的执行 npm。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 清单字段只认字符串数组，其他静默丢弃 | `core/pi-manifest.ts:17-35` | `src/package-json.ts` |
| 有清单只看清单；没有清单看约定目录 | `core/package-manager.ts:2172-2201` | `src/resources.ts` 的 `collectPackageResources` |
| 扩展 / 技能 / prompt / 主题各自的发现规则 | `core/package-manager.ts:312-442`、`:557-653` | `src/tree.ts` |
| 过滤四步，`+` `-` 只认精确路径 | `core/package-manager.ts:655-785` | `src/patterns.ts` |
| 过滤器没写的类型退回默认，可能比清单多 | `core/package-manager.ts:2204-2224`、`:2275-2296` | `src/resources.ts` 的 `defaultFiles`、`candidateFiles` |
| `autoload: false` 是差量 | `core/package-manager.ts:787-803`、`:2252-2268` | `src/resources.ts` 的 `deltaResources` |
| 五级优先级，包永远最后 | `core/package-manager.ts:176-192` | `src/precedence.ts` 的 `precedenceRank`、`resolveNames` |
| 包身份不含版本，项目赢 | `core/package-manager.ts:1687-1730` | `src/precedence.ts` 的 `packageIdentity`、`dedupePackages` |
| 第三方包的 install 参数里没有 `--ignore-scripts` | `core/package-manager.ts:1785-1806`、`:1772-1778` | `src/gate.ts` 的 `piInstallArgs`、`gitInstallArgs` |
| pi 自己：`--ignore-scripts` + 按 `name@version` 的白名单 + 过期检查 | `package-manager-cli.ts:89-99`；`scripts/generate-coding-agent-shrinkwrap.mjs:13-16`、`:230-261` | `src/gate.ts` 的 `gatedInstallArgs`、`reviewInstallScripts` |

（pi 的路径以 `packages/coding-agent/src/` 为根，`scripts/` 以仓库根为根。）

```bash
npm start                                   # 五段演示：清单与约定目录、过滤器让资源变多、过滤与去重、装前检查、安装闸门
npm start -- demo/sneaky-pack --git         # 检查一个包目录；有「高」级发现时退出码为 1，可以接进 CI
npm test                                    # 62 个用例
```

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript，并用 `path.matchesGlob` 代替 minimatch。没有依赖，所以不用 `npm i`。

| 文件 | 内容 |
| --- | --- |
| `src/package-json.ts` | 把第三方 `package.json` 当外部输入校验，坏字段丢掉并警告 |
| `src/tree.ts` | 文件列表上的目录遍历与四类资源的发现规则 |
| `src/patterns.ts` | `applyPatterns` 四步过滤 |
| `src/resources.ts` | 清单 / 约定目录 / 过滤器三条路，`autoload: false` 差量 |
| `src/precedence.ts` | 五级优先级、同名冲突、包身份与去重 |
| `src/inspect.ts` | 装前检查：安装脚本、依赖写法、清单问题，按高 / 中 / 提示排序 |
| `src/gate.ts` | install 参数、lockfile 解析、白名单审查、补跑参数 |
| `src/load.ts` | 读包目录：不跟随符号链接，限制文件数与深度 |
| `src/main.ts` | 演示与命令行入口 |
| `demo/` | 两个演示包、一份 lockfile、一份白名单 |
| `src/*.test.ts` | `node:test` 用例 |

本例的简化：子目录自己的 `package.json` 扩展入口、`.gitignore` 类忽略规则、glob 穿过符号链接这几种情况没有实现；pnpm 与 bun 的依赖脚本默认策略也不在模拟范围内（见正文 13.5 节）。

打包与分发的三条经验：

1. **有清单就只看清单。** `"pi": {}` 会让包什么也不加载，清单里写错的字段和不存在的路径都会被静默跳过。发布前跑一遍检查，比用户报「装上没反应」便宜（演示第 1、4 段）。
2. **过滤器不只是收窄。** 给包加一条只针对扩展的过滤规则，清单里没写的主题目录会被重新发现——文档说过滤器「narrow down」，代码在没写的类型上退回了另一套默认（演示第 2 段）。
3. **安装就是执行代码。** `pi install` 走 npm 时会跑包和它全部依赖的安装脚本；git 来源还会跑包自己的 `prepare`。pi 给自己装依赖时用的那套纪律可以原样搬过来：先 `--ignore-scripts`，审 lockfile，按 `name@version` 放行，白名单过期就删（演示第 5 段）。
