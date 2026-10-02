import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.ts";
import { DEFAULT_POLICY, type Policy, type Request } from "./types.ts";

const CWD = "/work/repo";
const AUTO: Policy = { ...DEFAULT_POLICY, mode: "auto" };
const READ_ONLY: Policy = { ...DEFAULT_POLICY, mode: "read-only" };
const bash = (command: string, origin: Request["origin"] = "model"): Request => ({ origin, tool: "bash", command });
const got = (policy: Policy, request: Request) => {
  const d = decide(policy, request, CWD);
  return `${d.verdict}:${d.rule}`;
};

test("只读工具在任何模式下放行", () => {
  for (const policy of [DEFAULT_POLICY, AUTO, READ_ONLY]) assert.equal(got(policy, { origin: "model", tool: "read", path: "/etc/passwd" }), "allow:read-only-tool");
});

test("ask 模式：普通命令和工作区内的写入都要问", () => {
  assert.equal(got(DEFAULT_POLICY, bash("npm test")), "ask:mode-ask");
  assert.equal(got(DEFAULT_POLICY, { origin: "model", tool: "write", path: "src/a.ts" }), "ask:mode-ask");
});

test("auto 模式：普通的放行，危险的和看不全的照样问", () => {
  assert.equal(got(AUTO, bash("npm test")), "allow:mode-auto");
  assert.equal(got(AUTO, { origin: "model", tool: "edit", path: "src/a.ts" }), "allow:mode-auto");
  assert.equal(got(AUTO, bash("rm -fr build")), "ask:recursive-delete");
  assert.equal(got(AUTO, bash("python3 -c 'print(1)'")), "ask:unresolved");
});

test("read-only 模式：写和执行一律拒绝，不认识的工具也拒绝", () => {
  assert.equal(got(READ_ONLY, bash("ls")), "deny:mode-read-only");
  assert.equal(got(READ_ONLY, { origin: "model", tool: "write", path: "src/a.ts" }), "deny:mode-read-only");
  assert.equal(got(READ_ONLY, { origin: "model", tool: "deploy_prod" }), "deny:mode-read-only");
});

test("路径规则是拒绝，不是问：auto 模式也过不去", () => {
  assert.equal(got(AUTO, { origin: "model", tool: "write", path: ".env" }), "deny:protected-path");
  assert.equal(got(AUTO, { origin: "model", tool: "edit", path: "/etc/hosts" }), "deny:outside-write-roots");
});

test("同一条路径规则也管 bash 的重定向", () => {
  assert.equal(got(AUTO, bash("echo KEY=1 > .env")), "deny:protected-path");
  assert.equal(got(AUTO, bash("date >> ~/.bashrc")), "deny:outside-write-roots");
  assert.equal(got(AUTO, bash("make > build.log 2>&1")), "allow:mode-auto");
  assert.equal(got(AUTO, bash("make > /dev/null")), "allow:mode-auto");
  assert.equal(got(AUTO, bash("date > $OUT")), "ask:redirect-dynamic");
});

test("但 tee / cp 写同一个文件，静态规则看不见", () => {
  assert.equal(got(AUTO, bash("echo KEY=1 | tee .env")), "allow:mode-auto");
  assert.equal(got(AUTO, bash("cp /tmp/x .env")), "allow:mode-auto");
});

test("不认识的工具按会改东西处理：auto 也要问", () => {
  assert.equal(got(AUTO, { origin: "model", tool: "deploy_prod" }), "ask:unknown-tool");
});

test("缺字段的请求直接拒绝", () => {
  assert.equal(got(AUTO, { origin: "model", tool: "bash" }), "deny:malformed");
  assert.equal(got(AUTO, { origin: "model", tool: "bash", command: "  " }), "deny:malformed");
  assert.equal(got(AUTO, { origin: "model", tool: "write" }), "deny:malformed");
});

test("用户亲手敲的命令：默认和模型一样过规则，可以明确豁免", () => {
  assert.equal(got(AUTO, bash("rm -rf build", "user")), "ask:recursive-delete");
  assert.equal(got({ ...AUTO, gateUserCommands: false }, bash("rm -rf build", "user")), "allow:user-exempt");
  assert.equal(got({ ...READ_ONLY, gateUserCommands: false }, bash("rm -rf build", "model")), "deny:mode-read-only");
});

test("工具名大小写和空格不影响判断", () => {
  assert.equal(got(AUTO, { origin: "model", tool: " Bash ", command: "rm -rf x" }), "ask:recursive-delete");
});
