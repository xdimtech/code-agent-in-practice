/**
 * 共用类型。
 *
 * 一道架构闸门只回答一个问题：「这一条 import 允许吗？」
 *
 *   配置（config.ts）  有哪些层、每层在哪些目录、叫什么包名、允许依赖谁
 *   抽取（imports.ts） 一个文件里有哪些 import 说明符，各在第几行
 *   判定（classify.ts）一条 (导入方文件, 说明符) 允许还是违规——纯函数
 *   扫描（scan.ts）    唯一碰文件系统的地方
 *   自测（self-test.ts）用合成的 (导入方, 说明符) 对把每条规则各打一遍
 *
 * 判定是白名单：一条边没写进 mayImport 就是违规；认不出归属的内部目标也是违规。
 */

export interface Layer {
	/** 层名，配置里互相引用用的 */
	readonly name: string;
	/** 仓库相对的目录前缀，必须以 / 结尾，例如 packages/ai/src/ */
	readonly paths: readonly string[];
	/** 这一层对外的包名；裸说明符等于它或以「它/」开头，就算指向这一层 */
	readonly packages: readonly string[];
	/** 允许依赖的其他层（同层互相导入总是允许） */
	readonly mayImport: readonly string[];
}

export interface GateConfig {
	/** 层的列表，顺序无关；依赖图必须无环 */
	readonly layers: readonly Layer[];
	/** 内部包的 scope 前缀：以它开头却认不出是哪一层的裸说明符，算违规而不是放行 */
	readonly internalScopes: readonly string[];
	/** 路径里含这些片段的文件不扫（测试、示例、产物） */
	readonly ignore: readonly string[];
}

export type ViolationKind =
	/** 依赖了 mayImport 之外的层 */
	| "forbidden-edge"
	/** 导入方不在任何一层里 */
	| "unassigned-importer"
	/** 目标是内部代码（相对路径，或内部 scope 的包），却不在任何一层里 */
	| "unassigned-target";

export interface Violation {
	readonly kind: ViolationKind;
	readonly importer: string;
	readonly specifier: string;
	readonly message: string;
}

/** 一条 import 的说明符和它所在的行（从 1 开始） */
export interface ImportRef {
	readonly specifier: string;
	readonly line: number;
}

/** 说明符指向哪里 */
export type Target =
	| { readonly kind: "layer"; readonly layer: Layer }
	| { readonly kind: "external" }
	| { readonly kind: "unassigned"; readonly resolved: string };
