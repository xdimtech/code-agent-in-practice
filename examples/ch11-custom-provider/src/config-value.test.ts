import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedExec, missingEnvNames, parseTemplate, resolveConfigValue, resolveConfigValueOrThrow, type ResolveDeps } from "./config-value.ts";

const deps = (env: Record<string, string | undefined>, exec: ResolveDeps["exec"] = () => undefined): ResolveDeps => ({ env, exec });

test("模板：$NAME、${NAME} 换成环境变量，前后的字面量保留", () => {
  const d = deps({ HOST: "llm.example", PORT: "8443" });
  assert.equal(resolveConfigValue("https://$HOST:${PORT}/v1", d), "https://llm.example:8443/v1");
});

test("转义：$$ → $，$! → !；写不成变量名的 $ 和没闭合的 ${ 原样保留", () => {
  const d = deps({});
  assert.equal(resolveConfigValue("$$5", d), "$5");
  assert.equal(resolveConfigValue("$!echo", d), "!echo");
  assert.equal(resolveConfigValue("cost $5", d), "cost $5");
  assert.equal(resolveConfigValue("${oops", d), "${oops");
  assert.equal(resolveConfigValue("${not-a-name}", d), "${not-a-name}");
});

test("相邻字面量合并成一段", () => {
  assert.deepEqual(parseTemplate("a$$b"), [{ type: "literal", value: "a$b" }]);
});

test("任何一个变量缺失（或是空串），整个值都解析不出来", () => {
  const d = deps({ A: "x", EMPTY: "" });
  assert.equal(resolveConfigValue("${A}-${B}", d), undefined);
  assert.equal(resolveConfigValue("$EMPTY", d), undefined);
  assert.deepEqual(missingEnvNames("$A $B $EMPTY $B", d.env), ["B", "EMPTY"]);
});

test("! 开头是命令：取命令输出；只有开头的 ! 算数", () => {
  const seen: string[] = [];
  const d = deps({}, (command) => {
    seen.push(command);
    return "from-command";
  });
  assert.equal(resolveConfigValue("!op read secret", d), "from-command");
  assert.equal(resolveConfigValue("a!b", d), "a!b");
  assert.deepEqual(seen, ["op read secret"]);
});

test("OrThrow：错误信息点名缺的变量或失败的命令，不带任何值", () => {
  const d = deps({ PRESENT: "super-secret-value" });
  assert.throws(() => resolveConfigValueOrThrow("${PRESENT}${GONE}", "测试 key", d), (error: Error) => {
    assert.match(error.message, /环境变量未设置（GONE）/);
    assert.doesNotMatch(error.message, /super-secret-value/);
    return true;
  });
  assert.throws(() => resolveConfigValueOrThrow("!vault get x", "测试 key", d), /命令没有输出（vault get x）/);
});

test("cachedExec：同一条命令只执行一次，不同命令各自执行", () => {
  let runs = 0;
  const exec = cachedExec((command) => {
    runs += 1;
    return command.toUpperCase();
  });
  assert.equal(exec("a"), "A");
  assert.equal(exec("a"), "A");
  assert.equal(exec("b"), "B");
  assert.equal(runs, 2);
});
