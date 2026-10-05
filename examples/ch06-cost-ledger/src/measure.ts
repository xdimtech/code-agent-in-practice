/**
 * 在一个真仓库上量 RepoFacts（除 piIdenticalLines），只读，只调 git。
 *
 * 口径和全书一致：.ts / .tsx，路径里有 /src/，去掉 *.test.* / *.spec.*、tests? 目录和 examples 目录。
 * 行数按「换行符个数，末行无换行再加一」数，和 wc -l 对齐到同一个 git 版本。
 */

import { spawnSync } from "node:child_process";

import type { RepoFacts } from "./effort.ts";

export const SOURCE_PATTERN = /\.(ts|tsx)$/i;
const EXCLUDED = [/\.test\./, /\.spec\./, /(^|\/)tests?\//, /\/examples\//];

export const inScope = (path: string) => SOURCE_PATTERN.test(path) && path.includes("/src/") && !EXCLUDED.some((re) => re.test(path));

function runGit(repo: string, args: readonly string[], input?: string): Buffer {
	const r = spawnSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
	if (r.error) throw new Error(`跑不了 git：${r.error.message}`);
	if (r.status !== 0) throw new Error(`git ${args[0]} 失败：${r.stderr.toString().trim().split("\n")[0]}`);
	return r.stdout;
}

const git = (repo: string, args: readonly string[]) => runGit(repo, args).toString("utf8");

/** 数一份文本的行数：和 wc -l 一样数换行，末行没换行时补一 */
export const countLines = (text: string) => (text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** 一次 cat-file --batch 读出所有口径内文件，按字节数切开；每个文件起一次 git 太慢 */
export function countSourceLines(repo: string, rev = "HEAD"): { files: number; lines: number } {
	const paths = git(repo, ["ls-tree", "-r", "--name-only", rev]).split("\n").filter(inScope);
	const out = runGit(repo, ["cat-file", "--batch"], paths.map((p) => `${rev}:${p}\n`).join(""));
	let offset = 0;
	let files = 0;
	let lines = 0;
	while (offset < out.length) {
		const eol = out.indexOf(0x0a, offset);
		const header = out.subarray(offset, eol).toString("utf8").split(" ");
		offset = eol + 1;
		if (header.at(-1) === "missing") continue;
		const size = Number(header[2]);
		lines += countLines(out.subarray(offset, offset + size).toString("utf8"));
		files += 1;
		offset += size + 1;
	}
	return { files, lines };
}

export interface NumstatCommit {
	readonly added: number;
	readonly deleted: number;
}

/** 解析 `git log --numstat --format=@%H`：每个 commit 只数口径内文件，二进制文件（"-"）跳过 */
export function parseNumstat(text: string): NumstatCommit[] {
	const commits: NumstatCommit[] = [];
	let current: { added: number; deleted: number } | undefined;
	for (const line of text.split("\n")) {
		if (line.startsWith("@")) {
			if (current) commits.push(current);
			current = { added: 0, deleted: 0 };
			continue;
		}
		const [a, d, path] = line.split("\t");
		if (!current || path === undefined || a === "-" || !inScope(path)) continue;
		current = { added: current.added + Number(a), deleted: current.deleted + Number(d) };
	}
	if (current) commits.push(current);
	return commits;
}

/** 「作者 × ISO 周」去重；名字以 bot 结尾或带 [bot] 的账号不算 */
export function authorWeeks(lines: readonly string[]): number {
	const keys = lines
		.map((l) => l.split("\t"))
		.filter(([name]) => name !== undefined && !/\[bot\]|bot$/i.test(name))
		.map(([, email, week]) => `${email}|${week}`);
	return new Set(keys).size;
}

export function measureRepo(repo: string, name: string): Omit<RepoFacts, "piIdenticalLines"> {
	const commit = git(repo, ["rev-parse", "--short=8", "HEAD"]).trim();
	const log = git(repo, ["log", "--no-merges", "--format=%an\t%ae\t%ad", "--date=format:%G-%V"]).split("\n").filter(Boolean);
	const days = git(repo, ["log", "--no-merges", "--format=%ad", "--date=short"]).split("\n").filter(Boolean).sort();
	const numstat = parseNumstat(git(repo, ["log", "--no-merges", "--numstat", "--format=@%H"]));
	return {
		name,
		commit,
		lines: countSourceLines(repo).lines,
		commits: log.length,
		authors: new Set(log.map((l) => l.split("\t")[1])).size,
		authorWeeks: authorWeeks(log),
		firstDay: days[0] ?? "",
		lastDay: days.at(-1) ?? "",
		largestImportLines: numstat.reduce((max, c) => Math.max(max, c.added), 0),
		added: numstat.reduce((s, c) => s + c.added, 0),
		deleted: numstat.reduce((s, c) => s + c.deleted, 0),
	};
}
