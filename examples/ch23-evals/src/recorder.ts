/**
 * 产物落盘：一行一次运行，外加只读一遍的汇总。
 *
 * 两个动作都很平常，但有两个细节值得照抄：
 *
 *   - 目录 0700、文件 0600（`artifacts.ts:106-108`）。轨迹里有提示词、模型回复、
 *     工具读到的文件内容，默认权限 0644 意味着同机器上任何用户都能翻。
 *   - 落盘前先遮敏（`payload.ts:148-176`）。按字段名认（token、apikey、authorization…），
 *     再把整棵消息树里出现过的同值字符串一并换掉——不然凭据会以「恰好被写进回复里」
 *     的形式溜出去，只挡字段名是挡不住的。
 *
 * 这里没有「写不写」的开关：叫的是 eval，写下来的就是 eval 的原始材料，
 * 该不该落盘由调用方决定（这个例子里由 CLI 的 --out 决定）。
 */

import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, JsonValue, Observation, RunResult } from "./types.ts";

const REDACTED = "[REDACTED]";

/** 命中这些字段名（比较时去掉 - _ . 再小写）的值，一律换成 [REDACTED] */
const SENSITIVE_FIELD_KEYS: readonly string[] = [
	"apikey",
	"authorization",
	"cookie",
	"credential",
	"password",
	"privatekey",
	"secret",
	"token",
	"accesstoken",
	"refreshtoken",
	"sessionkey",
];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_.]/g, "");

export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_FIELD_KEYS.includes(normalizeKey(key));
}

/** 短于这个长度的值不当成凭据：太短的值到处撞车，遮了反而把正常内容换成占位符 */
const MIN_SECRET_LENGTH = 6;

/**
 * 先扫一遍，把「敏感字段上的值」收集起来；再拿这些值去全文替换。
 * 两步是因为凭据经常同时出现在两处：一个规规矩矩的字段上，和一句日志/回复里。
 */
export function collectSecrets(value: unknown, found: Set<string> = new Set()): Set<string> {
	const seen = new Set<unknown>();
	const queue: unknown[] = [value];
	while (queue.length > 0) {
		const current = queue.pop();
		if (current === null || typeof current !== "object" || seen.has(current)) continue;
		seen.add(current);
		for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
			if (isSensitiveKey(key) && typeof child === "string" && child.length >= MIN_SECRET_LENGTH) {
				found.add(child);
			} else if (child !== null && typeof child === "object") {
				queue.push(child);
			}
		}
	}
	return found;
}

export function redact(value: JsonValue, secrets: ReadonlySet<string>): JsonValue {
	if (typeof value === "string") {
		let out = value;
		for (const secret of secrets) out = out.split(secret).join(REDACTED);
		return out;
	}
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
	const entries = Object.entries(value).map(([key, item]): [string, JsonValue] => [
		key,
		isSensitiveKey(key) ? REDACTED : redact(item, secrets),
	]);
	return Object.fromEntries(entries);
}

export interface RunRecord {
	readonly schemaVersion: 1;
	readonly runId: string;
	readonly evalSet: string;
	readonly case: string;
	readonly harness: string;
	readonly repetition: number;
	/** 输入原文；多次重复跑同一条输入时靠它认人 */
	readonly input: string;
	readonly output: string;
	readonly events: readonly AgentEvent[];
	readonly score?: number;
	readonly rationale?: string;
	readonly usage: RunResult["usage"];
	readonly observation: Observation;
}

export interface RecorderOptions {
	/** 产物目录。目录 0700，文件 0600 */
	readonly outputDir: string;
	readonly runId: string;
}

export interface Recorder {
	readonly outputDir: string;
	readonly runId: string;
	record(entry: Omit<RunRecord, "schemaVersion" | "runId" | "observation"> & { readonly observation: Observation }): void;
	close(): void;
}

/**
 * 目录已经存在时，`mkdirSync` 的 mode 不起作用——它只管新建的那一层。
 * 产物目录要是事先被别的东西以 0755 建好了，0700 就是一句空话。
 * 这里不替调用方 chmod（`--out .` 会把整个项目目录改掉），只把实情说出来。
 */
export function permissionWarning(outputDir: string): string | undefined {
	const mode = statSync(outputDir).mode & 0o777;
	if ((mode & 0o077) === 0) return undefined;
	return `产物目录 ${outputDir} 的权限是 ${mode.toString(8)}，同机器的其他用户能读；建议换一个新目录，或者 chmod 700`;
}

/** Node 的 fs 没有「原子追加且自动建目录」，所以在这里做一次，之后走 appendFileSync */
export function createRecorder(options: RecorderOptions): Recorder {
	mkdirSync(options.outputDir, { recursive: true, mode: 0o700 });
	const runsPath = join(options.outputDir, "runs.jsonl");

	return {
		outputDir: options.outputDir,
		runId: options.runId,
		record(entry) {
			const asJson = entry as unknown as JsonValue;
			const secrets = collectSecrets(asJson);
			const record: RunRecord = {
				schemaVersion: 1,
				runId: options.runId,
				...entry,
			};
			const line = JSON.stringify(redact(record as unknown as JsonValue, secrets));
			appendFileSync(runsPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
		},
		close() {
			// appendFileSync 每次自己开关文件，没有留下要收的资源；留着这个方法是给
			// 以后换成流式写留个位置，调用方不用改
		},
	};
}

/** 读回一份产物。JSONL 坏了就当这一行不存在，不静默吞掉——用 onError 报出来 */
export function parseRuns(
	text: string,
	onError: (line: number, error: unknown) => void = () => {},
): RunRecord[] {
	const records: RunRecord[] = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") continue;
		try {
			records.push(JSON.parse(line) as RunRecord);
		} catch (error) {
			onError(index + 1, error);
		}
	}
	return records;
}
