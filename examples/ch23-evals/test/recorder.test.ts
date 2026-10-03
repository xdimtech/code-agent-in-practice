import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectSecrets, createRecorder, isSensitiveKey, parseRuns, permissionWarning, redact } from "../src/recorder.ts";
import type { JsonValue } from "../src/types.ts";

function withTempDir(run: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "ch23-recorder-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("按字段名认敏感字段，去掉 - _ . 再比，大小写不敏感", () => {
	for (const key of ["apiKey", "api_key", "API-KEY", "authorization", "accessToken", "private.key"]) {
		assert.equal(isSensitiveKey(key), true, key);
	}
	for (const key of ["tokenizer", "keynote", "cookies", "path"]) {
		assert.equal(isSensitiveKey(key), false, key);
	}
});

test("收集敏感字段上的值，不管嵌多深", () => {
	const secret = collectSecrets({ request: { headers: { Authorization: "Bearer sk-live-abcdef" } } });
	assert.deepEqual([...secret], ["Bearer sk-live-abcdef"]);
});

test("太短的值不当凭据：到处撞车，遮了反而把正常内容换掉", () => {
	assert.deepEqual([...collectSecrets({ token: "abc" })], []);
	assert.equal(collectSecrets({ token: "abcdef" }).size, 1);
});

test("遮敏先按字段名换，再按值全文换——凭据经常同时出现在两处", () => {
	const value: JsonValue = {
		headers: { Authorization: "Bearer sk-live-abcdef" },
		reply: "我用了 Bearer sk-live-abcdef 这个凭据",
	};
	const secrets = collectSecrets(value);
	const redacted = redact(value, secrets);
	assert.equal(JSON.stringify(redacted).includes("sk-live-abcdef"), false);
	assert.equal((redacted as Record<string, JsonValue>).reply, "我用了 [REDACTED] 这个凭据");
});

test("数组里的凭据一样要遮，不能只走对象分支", () => {
	const value: JsonValue = { list: [{ password: "hunter2hunter2" }] };
	const redacted = JSON.stringify(redact(value, collectSecrets(value)));
	assert.equal(redacted.includes("hunter2hunter2"), false);
});

test("循环引用不会把收集器转死", () => {
	interface Node {
		name: string;
		self?: Node;
	}
	const node: Node = { name: "a" };
	node.self = node;
	assert.deepEqual([...collectSecrets(node)], []);
});

test("落盘时目录 0700、文件 0600", () => {
	withTempDir((directory) => {
		const outputDir = join(directory, "eval");
		const recorder = createRecorder({ outputDir, runId: "run-1" });
		recorder.record({
			evalSet: "工具边界",
			case: "hello-extension",
			harness: "baseline-write",
			repetition: 1,
			input: "建个文件",
			output: "建好了",
			events: [],
			usage: { provider: "scripted", model: "baseline-write" },
			observation: { evalSet: "工具边界", groupKey: "hello-extension#0", repetition: 1, harness: "baseline-write", score: 1 },
		});
		recorder.close();

		assert.equal(statSync(outputDir).mode & 0o777, 0o700);
		assert.equal(statSync(join(outputDir, "runs.jsonl")).mode & 0o777, 0o600);
	});
});

test("目录事先以 0755 建好，mkdir 的 mode 不起作用——要报出来，不替人 chmod", () => {
	withTempDir((directory) => {
		const outputDir = join(directory, "eval");
		mkdirSync(outputDir, { mode: 0o755 });
		chmodSync(outputDir, 0o755);
		createRecorder({ outputDir, runId: "run-1" });
		assert.equal(statSync(outputDir).mode & 0o777, 0o755);
		assert.match(permissionWarning(outputDir) ?? "", /755/);

		chmodSync(outputDir, 0o700);
		assert.equal(permissionWarning(outputDir), undefined);
	});
});

test("一行一条记录，带 schemaVersion，读回来是同一个对象", () => {
	withTempDir((directory) => {
		const recorder = createRecorder({ outputDir: directory, runId: "run-2" });
		for (const repetition of [1, 2]) {
			recorder.record({
				evalSet: "工具边界",
				case: "patch-existing",
				harness: "careful-write",
				repetition,
				input: "改版本号",
				output: "改好了",
				events: [{ type: "response", content: "改好了" }],
				score: 1,
				rationale: "3 项全过",
				usage: { provider: "scripted", model: "careful-write", toolCalls: 2 },
				observation: { evalSet: "工具边界", groupKey: "patch-existing#0", repetition, harness: "careful-write", score: 1 },
			});
		}
		recorder.close();

		const text = readFileSync(join(directory, "runs.jsonl"), "utf8");
		assert.equal(text.trimEnd().split("\n").length, 2);
		const records = parseRuns(text);
		assert.equal(records.length, 2);
		assert.equal(records[0].schemaVersion, 1);
		assert.equal(records[0].runId, "run-2");
		assert.equal(records[1].repetition, 2);
		assert.deepEqual(records[1].events, [{ type: "response", content: "改好了" }]);
	});
});

test("落盘前遮敏：写进去的轨迹里不该有凭据", () => {
	withTempDir((directory) => {
		const recorder = createRecorder({ outputDir: directory, runId: "run-3" });
		recorder.record({
			evalSet: "工具边界",
			case: "hello-extension",
			harness: "baseline-write",
			repetition: 1,
			input: "读一下配置",
			output: "读到了",
			events: [{ type: "tool_call", name: "read_file", args: { path: ".env", apiKey: "sk-live-abcdef" } }],
			usage: { provider: "scripted", model: "baseline-write" },
			observation: { evalSet: "工具边界", groupKey: "hello-extension#0", repetition: 1, harness: "baseline-write", score: 0 },
		});
		recorder.close();

		const text = readFileSync(join(directory, "runs.jsonl"), "utf8");
		assert.equal(text.includes("sk-live-abcdef"), false);
		assert.ok(text.includes("[REDACTED]"));
	});
});

test("坏行不静默吞掉：用 onError 报行号，能读的照样读回来", () => {
	const text = '{"schemaVersion":1,"runId":"a"}\n这不是 JSON\n{"schemaVersion":1,"runId":"b"}\n';
	const seen: number[] = [];
	const records = parseRuns(text, (line) => seen.push(line));
	assert.deepEqual(seen, [2]);
	assert.equal(records.length, 2);
	assert.equal(records[1].runId, "b");
});

test("parseRuns 跳过空行，不算坏行", () => {
	let broken = 0;
	const records = parseRuns('{"a":1}\n\n\n{"a":2}\n', () => {
		broken += 1;
	});
	assert.equal(records.length, 2);
	assert.equal(broken, 0);
});

test("追加不覆盖：两次 record 得到一个文件两行，两次会话各写各的文件", () => {
	withTempDir((directory) => {
		const first = createRecorder({ outputDir: directory, runId: "run-a" });
		first.record({
			evalSet: "s",
			case: "c",
			harness: "h",
			repetition: 1,
			input: "i",
			output: "o",
			events: [],
			usage: { provider: "scripted", model: "h" },
			observation: { evalSet: "s", groupKey: "c#0", repetition: 1, harness: "h", score: 1 },
		});
		first.close();
		const second = createRecorder({ outputDir: directory, runId: "run-b" });
		second.record({
			evalSet: "s",
			case: "c",
			harness: "h",
			repetition: 2,
			input: "i",
			output: "o",
			events: [],
			usage: { provider: "scripted", model: "h" },
			observation: { evalSet: "s", groupKey: "c#0", repetition: 2, harness: "h", score: 0 },
		});
		second.close();

		const records = parseRuns(readFileSync(join(directory, "runs.jsonl"), "utf8"));
		assert.deepEqual(records.map((record) => record.runId), ["run-a", "run-b"]);
	});
});
