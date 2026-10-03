/**
 * 必补第四件：装扩展时不跑依赖的安装脚本。
 *
 * `pi install npm:<包>` 最后执行的是 `npm install <包> --prefix <根> --legacy-peer-deps`
 * （core/package-manager.ts:1785-1806），参数里没有 --ignore-scripts；
 * 子进程的环境就是 pi 自己的 process.env（:16、:2604-2611）。
 * 所以包和它的每一个依赖的 preinstall / install / postinstall 都会以你的身份、带着你的环境变量跑一遍。
 * 第 13 章讲过这件事本身，这里只回答「怎么用设置关掉、怎么核对关没关掉」。
 *
 * 两种关法，各有代价：
 *   A. 环境变量 npm_config_ignore_scripts=true。npm 读它；但它也会跟着 getShellEnv() 流进模型的 bash，
 *      模型在项目里跑的 npm install 同样不跑脚本（除非第三件的白名单把它滤掉——默认白名单会滤掉）。
 *   B. 设置 "npmCommand": ["npm", "--ignore-scripts"]。只影响 pi 自己调 npm；
 *      代价是设了 npmCommand 之后，git 来源的包装依赖改用不带 --omit=dev 的 install（:1772-1778）。
 */

export interface InstallFacts {
	/** settings.json 里的 npmCommand；没设就是 undefined */
	readonly npmCommand?: readonly string[];
	/** 启动 pi 的那个环境 */
	readonly env: Readonly<Record<string, string | undefined>>;
}

export type ScriptStatus =
	| { readonly kind: "skipped"; readonly manager: string; readonly via: "env" | "argv" }
	| { readonly kind: "runs"; readonly manager: string }
	| { readonly kind: "manager-default"; readonly manager: string }
	| { readonly kind: "unknown"; readonly manager: string };

/** 照抄 pi 的 getPackageManagerName（:1759-1765）：取最后一个 `--` 之后的那一项，没有就取第一项。 */
export function packageManagerName(npmCommand: readonly string[] | undefined): string {
	const parts = npmCommand && npmCommand.length > 0 ? npmCommand : ["npm"];
	const separator = parts.lastIndexOf("--");
	const command = separator >= 0 ? parts[separator + 1] : parts[0];
	if (!command) return "";
	const base = command.split(/[\\/]/).pop() ?? command;
	return base.replace(/\.(cmd|exe)$/i, "");
}

/** 包管理器那一项之后的参数。`mise exec node@20 -- npm --ignore-scripts` 里只看 `--` 后面。 */
function managerArgs(npmCommand: readonly string[] | undefined): readonly string[] {
	if (!npmCommand || npmCommand.length === 0) return [];
	const separator = npmCommand.lastIndexOf("--");
	return npmCommand.slice(separator >= 0 ? separator + 2 : 1);
}

const IGNORE_FLAG = /^--ignore-scripts(=true)?$/;

/** npm 的环境变量名大小写都认；这里只认 "true"，其他写法当作没设，宁可报「会跑」。 */
const envIgnores = (env: InstallFacts["env"]): boolean =>
	Object.entries(env).some(([name, value]) => name.toLowerCase() === "npm_config_ignore_scripts" && value === "true");

export function installScriptStatus(facts: InstallFacts): ScriptStatus {
	const manager = packageManagerName(facts.npmCommand);
	// pnpm、bun 默认不跑依赖的安装脚本，要显式放行（第 13 章 13.5 的【推断】）——这里不替它们下结论
	if (manager === "pnpm" || manager === "bun") return { kind: "manager-default", manager };
	if (manager !== "npm") return { kind: "unknown", manager };
	if (managerArgs(facts.npmCommand).some((arg) => IGNORE_FLAG.test(arg))) return { kind: "skipped", manager, via: "argv" };
	if (envIgnores(facts.env)) return { kind: "skipped", manager, via: "env" };
	return { kind: "runs", manager };
}
