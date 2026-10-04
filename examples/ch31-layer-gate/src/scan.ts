/**
 * 扫描：唯一碰文件系统的地方。只走配置里列出的层目录。
 *
 * 报告里带上扫了多少文件、多少条 import——「0 违规」只有在「确实扫到了东西」时才有意义。
 * Step-Code 的分层闸门头注释还写着「the real scan finds nothing to flag yet」，
 * 而它说的那个目录早已有了 6,753 行代码：只看「通过」两个字，分不清是干净还是没扫到。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { checkImport } from "./classify.ts";
import { extractImports } from "./imports.ts";
import type { GateConfig, Violation } from "./types.ts";

const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

export interface Finding extends Violation {
	readonly line: number;
}

export interface ScanReport {
	readonly files: number;
	readonly imports: number;
	readonly findings: readonly Finding[];
	/** 配置里列了、仓库里却不存在的目录 */
	readonly missingPaths: readonly string[];
}

const toRepoPath = (root: string, file: string) => relative(root, file).split(sep).join("/");

function collect(root: string, dir: string, ignore: readonly string[], into: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		const repoPath = toRepoPath(root, full);
		if (ignore.some((fragment) => repoPath.includes(fragment))) continue;
		if (entry.isDirectory()) collect(root, full, ignore, into);
		else if (entry.isFile() && SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) into.push(full);
	}
}

export function listSourceFiles(root: string, config: GateConfig): { files: string[]; missingPaths: string[] } {
	const files: string[] = [];
	const missingPaths: string[] = [];
	const prefixes = [...new Set(config.layers.flatMap((l) => l.paths))].toSorted();
	for (const prefix of prefixes) {
		// 嵌套的前缀会被外层目录一并扫到，跳过免得重复
		if (prefixes.some((other) => other !== prefix && prefix.startsWith(other))) continue;
		const dir = join(root, prefix);
		if (existsSync(dir)) collect(root, dir, config.ignore, files);
		else missingPaths.push(prefix);
	}
	return { files: files.toSorted(), missingPaths };
}

export function scanRepo(root: string, config: GateConfig): ScanReport {
	const { files, missingPaths } = listSourceFiles(root, config);
	const findings: Finding[] = [];
	let imports = 0;
	for (const file of files) {
		const importer = toRepoPath(root, file);
		for (const ref of extractImports(readFileSync(file, "utf8"))) {
			imports++;
			const violation = checkImport(config, importer, ref.specifier);
			if (violation) findings.push({ ...violation, line: ref.line });
		}
	}
	return { files: files.length, imports, findings, missingPaths };
}
