/**
 * 自测：用合成的 (导入方, 说明符) 对把每条规则各打一遍，不用任何夹具文件。
 *
 * 不用夹具文件的理由和 Step-Code 一样（check-layer-direction.mjs 的头注释）：一个故意违规的
 * 夹具一旦放进被扫描的目录，真正的闸门就会扫到它。
 *
 * 判定函数和抽取函数都作为参数传进来，默认是真的那两个。测试里换成坏掉的版本，
 * 可以确认自测真的会失败——自测本身也要被测。
 */

import { checkImport } from "./classify.ts";
import { extractImports } from "./imports.ts";
import type { GateConfig, ImportRef, Violation, ViolationKind } from "./types.ts";

/** 合成的三层：contracts ← core ← app，外加一个只许依赖 contracts 的 ui */
export const SELF_TEST_CONFIG: GateConfig = {
	layers: [
		{ name: "contracts", paths: ["packages/contracts/src/"], packages: ["@demo/contracts"], mayImport: [] },
		{ name: "core", paths: ["packages/core/src/"], packages: ["@demo/core"], mayImport: ["contracts"] },
		{ name: "ui", paths: ["packages/ui/src/"], packages: ["@demo/ui"], mayImport: ["contracts"] },
		{ name: "app", paths: ["apps/cli/src/"], packages: ["@demo/cli"], mayImport: ["core", "ui", "contracts"] },
		// 嵌套目录可以单独归层：app 里的 ui 适配层不许回头依赖 app 的其余部分
		{ name: "app-ui", paths: ["apps/cli/src/ui/"], packages: [], mayImport: ["ui", "contracts"] },
	],
	internalScopes: ["@demo/"],
	ignore: [],
};

export interface EdgeCase {
	readonly importer: string;
	readonly specifier: string;
	/** undefined 表示应当放行 */
	readonly expect: ViolationKind | undefined;
}

export const EDGE_CASES: readonly EdgeCase[] = [
	// 放行
	{ importer: "apps/cli/src/main.ts", specifier: "@demo/core", expect: undefined },
	{ importer: "apps/cli/src/main.ts", specifier: "@demo/core/session", expect: undefined },
	{ importer: "packages/core/src/loop.ts", specifier: "./types.ts", expect: undefined },
	{ importer: "packages/core/src/loop.ts", specifier: "../../contracts/src/index.ts", expect: undefined },
	{ importer: "packages/core/src/loop.ts", specifier: "node:fs", expect: undefined },
	{ importer: "packages/core/src/loop.ts", specifier: "typebox", expect: undefined },
	{ importer: "apps/cli/src/ui/render.ts", specifier: "@demo/ui", expect: undefined },
	// 向上依赖
	{ importer: "packages/contracts/src/index.ts", specifier: "@demo/core", expect: "forbidden-edge" },
	{ importer: "packages/core/src/loop.ts", specifier: "@demo/cli", expect: "forbidden-edge" },
	{ importer: "packages/core/src/loop.ts", specifier: "../../../apps/cli/src/main.ts", expect: "forbidden-edge" },
	// 平级之间没有写进 mayImport，同样不许
	{ importer: "packages/ui/src/view.ts", specifier: "@demo/core", expect: "forbidden-edge" },
	// 嵌套层：最长前缀胜出，所以 app-ui 不能回头依赖 app
	{ importer: "apps/cli/src/ui/render.ts", specifier: "../main.ts", expect: "forbidden-edge" },
	// 包名前缀不能误配：@demo/core-extra 不是 @demo/core
	{ importer: "packages/core/src/loop.ts", specifier: "@demo/core-extra", expect: "unassigned-target" },
	// 认不出的内部目标：失败关闭
	{ importer: "packages/core/src/loop.ts", specifier: "../../scratch/hack.ts", expect: "unassigned-target" },
	{ importer: "packages/core/src/loop.ts", specifier: "@demo/unknown", expect: "unassigned-target" },
	{ importer: "scripts/release.ts", specifier: "@demo/core", expect: "unassigned-importer" },
];

export interface ScanCase {
	readonly name: string;
	readonly source: string;
	readonly expect: readonly ImportRef[];
}

export const SCAN_CASES: readonly ScanCase[] = [
	{
		name: "四种写法",
		source: 'import a from "a";\nimport { b, c } from "b";\nimport "c";\nexport * from "d";\nconst e = await import("e");\nconst f = require("f");',
		expect: [
			{ specifier: "a", line: 1 },
			{ specifier: "b", line: 2 },
			{ specifier: "c", line: 3 },
			{ specifier: "d", line: 4 },
			{ specifier: "e", line: 5 },
			{ specifier: "f", line: 6 },
		],
	},
	{
		name: "跨行的 import type",
		source: 'import type {\n\tA,\n\tB,\n} from "types";',
		expect: [{ specifier: "types", line: 1 }],
	},
	{
		name: "注释和模板字符串里的不算",
		source: '// import x from "no1";\n/* import "no2" */\nconst doc = `import y from "no3"`;\nimport z from "yes";',
		expect: [{ specifier: "yes", line: 4 }],
	},
	{
		name: "方法调用不算",
		source: 'loader.import("no");\nreimport("no");',
		expect: [],
	},
];

type Check = (config: GateConfig, importer: string, specifier: string) => Violation | undefined;
type Extract = (source: string) => ImportRef[];

/** 返回失败描述的列表；空列表表示自测通过 */
export function runSelfTest(check: Check = checkImport, extract: Extract = extractImports): string[] {
	const failures: string[] = [];
	for (const c of EDGE_CASES) {
		const got = check(SELF_TEST_CONFIG, c.importer, c.specifier)?.kind;
		if (got !== c.expect) failures.push(`${c.importer} → ${c.specifier}：期望 ${c.expect ?? "放行"}，得到 ${got ?? "放行"}`);
	}
	for (const c of SCAN_CASES) {
		const got = JSON.stringify(extract(c.source));
		if (got !== JSON.stringify(c.expect)) failures.push(`抽取「${c.name}」：期望 ${JSON.stringify(c.expect)}，得到 ${got}`);
	}
	return failures;
}
