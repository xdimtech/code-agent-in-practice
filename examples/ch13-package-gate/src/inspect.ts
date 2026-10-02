// 装之前先看一眼：把一个包在 pi 里「会发生什么」列成清单。
// 高：安装时会执行包里的代码；中：装上之后行为和作者以为的不一样；提示：不影响运行，但值得改。

import type { ParsedPackage } from "./package-json.ts";
import { RESOURCE_TYPES } from "./package-json.ts";
import { enabledPaths, type Collected } from "./resources.ts";
import { collectResourceFiles, isFile, type FileTree } from "./tree.ts";

export type Severity = "高" | "中" | "提示";
export type SourceKind = "npm" | "git" | "local";

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
}

/** npm install 时会自动执行的三个钩子 */
export const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;

/** 由宿主提供、扩展应写成 peerDependencies: "*" 的模块（docs/packages.md:171） */
export const HOST_MODULES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

const finding = (severity: Severity, code: string, message: string): Finding => ({ severity, code, message });

function installScriptFindings({ pkg }: ParsedPackage, tree: FileTree, source: SourceKind): Finding[] {
  // 本地来源 pi 不跑 npm（install() 只检查路径存在），脚本不会被触发
  const severity: Severity = source === "local" ? "提示" : "高";
  const hooks = INSTALL_HOOKS.filter((hook) => pkg.scripts[hook] !== undefined).map((hook) =>
    finding(severity, `script:${hook}`, `${hook} 会在安装时执行：${pkg.scripts[hook]}`),
  );
  // 有 binding.gyp 又没写 install/preinstall 时，npm 会替你补一个 "node-gyp rebuild"
  const gyp = isFile(tree, "binding.gyp") && pkg.scripts.install === undefined && pkg.scripts.preinstall === undefined
    ? [finding(severity, "script:implicit-gyp", "有 binding.gyp：npm 会隐式执行 node-gyp rebuild")]
    : [];
  // git 来源是在克隆目录里跑 npm install，包本身是根项目，prepare 也会跑
  const prepare = source === "git" && pkg.scripts.prepare !== undefined
    ? [finding("高", "script:prepare", `git 来源会执行 prepare：${pkg.scripts.prepare}`)]
    : [];
  return [...hooks, ...gyp, ...prepare];
}

function dependencyFindings({ pkg }: ParsedPackage): Finding[] {
  const host = new Set<string>(HOST_MODULES);
  const inDeps = Object.keys(pkg.dependencies).filter((d) => host.has(d)).map((d) =>
    finding("中", "dep:host-in-dependencies", `${d} 写在 dependencies 里：运行时用的是宿主那份，装进来的只是多一份供应链面；应改为 peerDependencies "*"`),
  );
  const bundled = pkg.bundledDependencies.filter((d) => host.has(d)).map((d) =>
    finding("中", "dep:host-bundled", `${d} 不该打进 bundledDependencies：bundle 留给其他 pi 包，宿主模块由 pi 提供`),
  );
  return [...inDeps, ...bundled];
}

function manifestFindings(parsed: ParsedPackage, tree: FileTree, collected: Collected): Finding[] {
  const warnings = parsed.warnings.map((w) => finding("中", "manifest:dropped", w));
  const unmatched = collected.unmatched.map((u) => finding("中", "manifest:unmatched", `清单条目没有对应文件，pi 会静默跳过：${u}`));
  const total = RESOURCE_TYPES.reduce((n, t) => n + enabledPaths(collected.resources, t).length, 0);
  const empty = total === 0
    ? [finding("中", "manifest:empty", collected.mode === "convention"
        ? "既没有 pi 清单也没有约定目录：npm/git 来源什么也不加载，本地来源会把整个目录当成一个扩展"
        : "清单解析出 0 个资源：装上之后什么也不加载")]
    : [];
  // 有清单时约定目录被整体忽略；目录里有文件、清单又没写这一类，多半是作者以为两者会合并
  const shadowed = collected.mode === "manifest"
    ? RESOURCE_TYPES.filter((t) => parsed.pkg.pi?.[t] === undefined)
        .map((t) => [t, collectResourceFiles(tree, t, t).length] as const)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => finding("中", "manifest:shadows-convention", `有 pi 清单但没写 ${t}：${t}/ 下 ${n} 个文件不会加载`))
    : [];
  return [...warnings, ...unmatched, ...empty, ...shadowed];
}

function galleryFindings({ pkg }: ParsedPackage): Finding[] {
  return pkg.keywords.includes("pi-package") ? [] : [finding("提示", "gallery:keyword", "keywords 里没有 pi-package，包画廊搜不到它")];
}

const ORDER: Readonly<Record<Severity, number>> = { 高: 0, 中: 1, 提示: 2 };

export function inspectPackage(parsed: ParsedPackage, tree: FileTree, collected: Collected, source: SourceKind): readonly Finding[] {
  return [
    ...installScriptFindings(parsed, tree, source),
    ...dependencyFindings(parsed),
    ...manifestFindings(parsed, tree, collected),
    ...galleryFindings(parsed),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export const hasBlocking = (findings: readonly Finding[]): boolean => findings.some((f) => f.severity === "高");
