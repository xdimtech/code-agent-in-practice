/**
 * 在临时目录里真的跑一次 npm install，看安装脚本跑没跑、看没看见环境变量。
 *
 * 装的是一个本地目录包，postinstall 只做一件事：把「我跑了」和「我看没看见 PREFLIGHT_FAKE_TOKEN」
 * 写进一个标记文件。不联网（--offline），不碰你的全局 npm 目录。
 *
 * 参数照 pi 的 getNpmInstallArgs（core/package-manager.ts:1805）：install <spec> --prefix <根> --legacy-peer-deps，
 * 只多加了 --offline --no-audit --no-fund，让它不去碰网络。
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 假的凭据名，值是占位符。只用来看安装脚本能不能读到启动环境里的变量 */
export const FAKE_TOKEN_NAME = "PREFLIGHT_FAKE_TOKEN";

export interface LabVariant {
	readonly label: string;
	/** 加在 npm 和 install 之间，相当于 settings 里的 npmCommand 多出来的那几项 */
	readonly npmArgs: readonly string[];
	readonly extraEnv: Readonly<Record<string, string>>;
}

export const VARIANTS: readonly LabVariant[] = [
	{ label: "pi 默认", npmArgs: [], extraEnv: {} },
	{ label: "A 环境变量", npmArgs: [], extraEnv: { npm_config_ignore_scripts: "true" } },
	{ label: "B npmCommand", npmArgs: ["--ignore-scripts"], extraEnv: {} },
];

export interface LabRow {
	readonly label: string;
	readonly exitCode: number | null;
	readonly ran: boolean;
	readonly sawToken: boolean;
}

const MARKER_SCRIPT = `const fs = require("node:fs");
fs.writeFileSync(process.env.PREFLIGHT_MARKER, JSON.stringify({ ran: true, sawToken: Boolean(process.env.${FAKE_TOKEN_NAME}) }));
`;

function writePackage(dir: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sneaky-pack", version: "1.0.0", scripts: { postinstall: "node marker.cjs" } }, null, 2));
	writeFileSync(join(dir, "marker.cjs"), MARKER_SCRIPT);
}

function readMarker(path: string): { ran: boolean; sawToken: boolean } {
	if (!existsSync(path)) return { ran: false, sawToken: false };
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (typeof parsed !== "object" || parsed === null) throw new Error(`标记文件格式不对：${path}`);
	const record = parsed as Record<string, unknown>;
	return { ran: record.ran === true, sawToken: record.sawToken === true };
}

export function runVariant(work: string, variant: LabVariant, npm: string, index: number): LabRow {
	const root = join(work, `root-${index}`);
	const marker = join(work, `marker-${index}.json`);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "pi-extensions", private: true }));
	const args = [...variant.npmArgs, "install", join(work, "pkg"), "--prefix", root, "--legacy-peer-deps", "--offline", "--no-audit", "--no-fund"];
	const result = spawnSync(npm, args, {
		encoding: "utf8",
		env: { ...process.env, ...variant.extraEnv, PREFLIGHT_MARKER: marker, [FAKE_TOKEN_NAME]: "placeholder" },
	});
	if (result.error) throw new Error(`跑不了 ${npm}：${result.error.message}`);
	return { label: variant.label, exitCode: result.status, ...readMarker(marker) };
}

export function runInstallLab(npm = "npm", variants: readonly LabVariant[] = VARIANTS): readonly LabRow[] {
	const work = mkdtempSync(join(tmpdir(), "ch22-install-lab-"));
	try {
		writePackage(join(work, "pkg"));
		return variants.map((variant, index) => runVariant(work, variant, npm, index));
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}
