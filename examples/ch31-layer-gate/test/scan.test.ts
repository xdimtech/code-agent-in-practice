import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { listSourceFiles, scanRepo } from "../src/scan.ts";
import { SELF_TEST_CONFIG as config } from "../src/self-test.ts";

const root = mkdtempSync(join(tmpdir(), "layer-gate-"));
after(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

write("packages/contracts/src/index.ts", 'export type Id = string;\n');
write("packages/core/src/loop.ts", 'import type { Id } from "@demo/contracts";\nimport { readFileSync } from "node:fs";\n');
write("packages/core/src/types.d.ts", 'import "@demo/cli";\n');
write("packages/ui/src/view.ts", '// import "@demo/core"\nimport { loop } from "@demo/core";\n');
write("packages/ui/src/view.test.ts", 'import "@demo/cli";\n');
write("packages/ui/src/notes.md", 'import "@demo/cli";\n');
write("apps/cli/src/main.ts", 'import "@demo/core";\nimport "@demo/ui";\n');
write("apps/cli/src/ui/render.ts", 'import { main } from "../main.ts";\n');
write("scripts/release.ts", 'import "@demo/cli";\n');

const scanned = { ...config, ignore: [".test."] };

test("listSourceFiles：只走层目录，跳过 .d.ts、非源码和 ignore，嵌套前缀不重复", () => {
	const { files, missingPaths } = listSourceFiles(root, scanned);
	const rel = files.map((f) => f.slice(root.length + 1));
	assert.deepEqual(rel, [
		"apps/cli/src/main.ts",
		"apps/cli/src/ui/render.ts",
		"packages/contracts/src/index.ts",
		"packages/core/src/loop.ts",
		"packages/ui/src/view.ts",
	]);
	assert.deepEqual(missingPaths, []);
});

test("scanRepo：报出两处违规，带行号；注释里的不算", () => {
	const report = scanRepo(root, scanned);
	assert.equal(report.files, 5);
	assert.equal(report.imports, 6);
	assert.deepEqual(
		report.findings.map((f) => [f.kind, f.importer, f.line]),
		[
			["forbidden-edge", "apps/cli/src/ui/render.ts", 1],
			["forbidden-edge", "packages/ui/src/view.ts", 2],
		],
	);
});

test("scanRepo：配置里的目录不存在时如实报告", () => {
	const ghost = { ...scanned, layers: [...scanned.layers, { name: "ghost", paths: ["packages/ghost/src/"], packages: [], mayImport: [] }] };
	assert.deepEqual(scanRepo(root, ghost).missingPaths, ["packages/ghost/src/"]);
});
