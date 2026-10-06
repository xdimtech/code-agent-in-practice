import { strict as assert } from "node:assert";
import { test } from "node:test";

import { actionFor, dropHandoff, planStep, runningStreaks, settleStep, startTurn } from "../src/breaker.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { REMINDER_1, REMINDER_3, reminder2 } from "../src/reminders.ts";
import { call, KIMI, outputs, read, repeatSteps, runStep } from "./helpers.ts";

test("同一步：键相同的调用只执行第一个，其余共享它的结果", () => {
	const calls = [read(), read(), read()];
	const plan = planStep(startTurn(), calls);
	assert.deepEqual(plan.calls.map((c) => c.kind), ["execute", "share", "share"]);
	const settled = settleStep(KIMI, plan, new Map([[calls[0]!.id, { text: "content", isError: false }]]));
	assert.deepEqual(settled.results.map((r) => [r.id, r.text, r.executed]), [
		[calls[0]!.id, "content", true],
		[calls[1]!.id, "content", false],
		[calls[2]!.id, "content", false],
	]);
	assert.equal(settled.events.filter((e) => e.kind === "dedup" && e.dupType === "same_step").length, 2);
});

test("同一步：共享到的是贴好提醒之后的结果", () => {
	const [, , third] = repeatSteps(KIMI, 3, () => read());
	assert.ok(third!.results[0]!.text.endsWith(REMINDER_1));
	const fourth = [read(), read()];
	const settled = runStep(KIMI, third!.state, fourth);
	assert.equal(settled.results[1]!.text, settled.results[0]!.text);
	assert.ok(settled.results[1]!.text.endsWith(REMINDER_1));
});

test("同一步里的重复也计入连续次数：[A A A] 之后再来一个 A 就是第 4 次", () => {
	const first = runStep(KIMI, startTurn(), [read(), read(), read()]);
	assert.equal(first.state.streak, 3);
	assert.equal(first.results[0]!.text, "ok");
	const second = runStep(KIMI, first.state, [read()]);
	assert.ok(second.results[0]!.text.endsWith(REMINDER_1));
	assert.ok(second.events.some((e) => e.kind === "repeat" && e.streak === 4 && e.action === "r1"));
});

test("连续计数按调用先后：同一步里排在后面的调用接着前面的数", () => {
	const settled = runStep(KIMI, startTurn(), [read("a"), read("b"), read("b")]);
	assert.match(settled.state.lastKey!, /"b"/);
	assert.equal(settled.state.streak, 2);
	assert.deepEqual(runningStreaks("x", 2, ["x", "x", "y", "y", "x"]), [3, 4, 1, 2, 1]);
	assert.deepEqual(runningStreaks(null, 0, []), []);
});

test("阈值：3、5、8 起三级提醒，12 真停", () => {
	const steps = repeatSteps(KIMI, 12, () => read());
	const actions = steps.map((s) => s.events.find((e) => e.kind === "repeat")?.action ?? "none");
	assert.deepEqual(actions, ["none", "none", "r1", "r1", "r2", "r2", "r2", "r3", "r3", "r3", "r3", "stop"]);
	assert.deepEqual(steps.map((s) => s.stopTurn), [...Array(11).fill(false), true]);
});

test("提醒贴在结果后面，不替换结果；第二级带上次数", () => {
	const steps = repeatSteps(KIMI, 8, () => read());
	assert.equal(steps[1]!.results[0]!.text, "ok");
	assert.equal(steps[2]!.results[0]!.text, `ok${REMINDER_1}`);
	assert.equal(steps[4]!.results[0]!.text, `ok${reminder2(5)}`);
	assert.match(steps[6]!.results[0]!.text, /连续发出 7 次/);
	assert.equal(steps[7]!.results[0]!.text, `ok${REMINDER_3}`);
});

test("提醒保留原来的 isError", () => {
	const two = repeatSteps(KIMI, 2, () => read());
	const c = read();
	const settled = settleStep(KIMI, planStep(two[1]!.state, [c]), new Map([[c.id, { text: "ENOENT", isError: true }]]));
	assert.equal(settled.results[0]!.isError, true);
	assert.equal(settled.results[0]!.text, `ENOENT${REMINDER_1}`);
});

test("第 12 次照样执行，贴最后一级提醒，要求结束这一轮并挂起交接", () => {
	const twelfth = repeatSteps(KIMI, 12, () => read()).at(-1)!;
	assert.equal(twelfth.results[0]!.executed, true);
	assert.equal(twelfth.results[0]!.text, `ok${REMINDER_3}`);
	assert.equal(twelfth.stopTurn, true);
	assert.equal(twelfth.state.handoff, "pending");
});

test("交接步：工具调用一律否决，不执行，结束这一轮", () => {
	const twelfth = repeatSteps(KIMI, 12, () => read()).at(-1)!;
	const calls = [read(), call("Bash", { command: "ls" })];
	const plan = planStep(twelfth.state, calls);
	assert.equal(plan.handoffStep, true);
	assert.deepEqual(plan.calls.map((c) => c.kind), ["veto", "veto"]);
	const settled = settleStep(KIMI, plan, outputs(calls, "不该出现"));
	assert.ok(settled.results.every((r) => !r.executed && r.isError && r.text.includes("只接受文字回复")));
	assert.equal(settled.stopTurn, true);
	assert.equal(settled.state.handoff, "done");
	assert.deepEqual(settled.events, [{ kind: "handoff", outcome: "vetoed" }]);
});

test("交接步：只写字就是正常收尾", () => {
	const twelfth = repeatSteps(KIMI, 12, () => read()).at(-1)!;
	const settled = settleStep(KIMI, planStep(twelfth.state, []), new Map());
	assert.deepEqual(settled.events, [{ kind: "handoff", outcome: "text" }]);
	assert.equal(settled.state.handoff, "done");
});

test("交接一轮只给一次：交接之后再连到 12 次，只停不再挂起", () => {
	const twelfth = repeatSteps(KIMI, 12, () => read()).at(-1)!;
	const done = settleStep(KIMI, planStep(twelfth.state, []), new Map()).state;
	const again = runStep(KIMI, { ...done, lastKey: twelfth.state.lastKey, streak: 11 }, [read()]);
	assert.equal(again.stopTurn, true);
	assert.equal(again.state.handoff, "done");
});

test("换一个调用，连续计数从 1 重新开始", () => {
	const three = repeatSteps(KIMI, 3, () => read("a"));
	const other = runStep(KIMI, three.at(-1)!.state, [read("b")]);
	assert.equal(other.state.streak, 1);
	const back = runStep(KIMI, other.state, [read("a")]);
	assert.equal(back.state.streak, 1);
	assert.equal(back.results[0]!.text, "ok");
});

test("kimi 原版：A B 交替 20 步没有任何提醒，只记 turn_repeat", () => {
	let state = startTurn();
	let turnRepeats = 0;
	for (let i = 0; i < 20; i++) {
		const settled = runStep(KIMI, state, [read(i % 2 === 0 ? "a" : "b")]);
		assert.equal(settled.results[0]!.text, "ok");
		turnRepeats += settled.events.filter((e) => e.kind === "turn_repeat").length;
		state = settled.state;
	}
	assert.equal(turnRepeats, 18);
	assert.equal(state.turnRepeats, 18);
});

test("kimi 原版：每步并行发 [A, B]，同样逃过断路器", () => {
	let state = startTurn();
	for (let i = 0; i < 20; i++) {
		const settled = runStep(KIMI, state, [read("a"), read("b")]);
		assert.ok(settled.results.every((r) => r.text === "ok"));
		state = settled.state;
	}
	assert.equal(state.streak, 1);
});

test("本例：交替检测在第三遍提醒一次，交替不断就不再重复提醒", () => {
	let state = startTurn();
	const reminded: number[] = [];
	for (let i = 1; i <= 10; i++) {
		const settled = runStep(DEFAULT_CONFIG, state, [read(i % 2 === 1 ? "a" : "b")]);
		if (settled.events.some((e) => e.kind === "cycle")) reminded.push(i);
		state = settled.state;
	}
	assert.deepEqual(reminded, [6]);
});

test("本例：交替断了再出现，会再提醒", () => {
	let state = startTurn();
	const seq = ["a", "b", "a", "b", "a", "b", "c", "a", "b", "a", "b", "a", "b"];
	const reminded: number[] = [];
	seq.forEach((p, i) => {
		const settled = runStep(DEFAULT_CONFIG, state, [read(p)]);
		if (settled.events.some((e) => e.kind === "cycle")) reminded.push(i + 1);
		state = settled.state;
	});
	assert.deepEqual(reminded, [6, 13]);
});

test("本例：并行 [A, B] 在第三步提醒，提醒贴在这一步最后一个结果上", () => {
	let state = startTurn();
	for (let i = 1; i <= 3; i++) {
		const settled = runStep(DEFAULT_CONFIG, state, [read("a"), read("b")]);
		if (i === 3) {
			assert.equal(settled.results[0]!.text, "ok");
			assert.match(settled.results[1]!.text, /以 2 个为一组、原样重复了 3 遍/);
		}
		state = settled.state;
	}
});

test("本例：真停的那一步不再叠交替提醒", () => {
	// 同一步里的重复不执行、不触发动作，但计入连续次数；于是第 3 步的 b 是第 5 次，正好真停，
	// 同时最后 12 个键是 [a b b b b b] 的两遍，周期 6 的交替也成立
	const config = { ...DEFAULT_CONFIG, remind1: 2, remind2: 3, remind3: 4, stopAt: 5, cycle: { enabled: true, maxPeriod: 6, repeats: 2 } };
	const b = () => read("b");
	const first = runStep(config, startTurn(), [read("a"), b(), b(), b(), b(), b()]);
	const second = runStep(config, first.state, [read("a"), b(), b(), b(), b()]);
	const third = runStep(config, second.state, [b()]);
	assert.equal(third.stopTurn, true);
	assert.ok(!third.events.some((e) => e.kind === "cycle"));
	assert.equal(third.results[0]!.text, `ok${REMINDER_3}`);
	assert.equal(third.state.cycleReminded, true);
});

test("turn_repeat：同一步里的重复不算，后面的步再出现才算", () => {
	const first = runStep(KIMI, startTurn(), [read("a"), read("a")]);
	assert.equal(first.state.turnRepeats, 0);
	const second = runStep(KIMI, first.state, [read("b")]);
	const third = runStep(KIMI, second.state, [read("a")]);
	assert.equal(third.state.turnRepeats, 1);
	assert.ok(third.events.some((e) => e.kind === "turn_repeat" && e.count === 1));
});

test("cross_step：紧接上一步的同一个调用记一次 dedup", () => {
	const first = runStep(KIMI, startTurn(), [read()]);
	const second = runStep(KIMI, first.state, [read()]);
	assert.ok(second.events.some((e) => e.kind === "dedup" && e.dupType === "cross_step"));
	assert.ok(!first.events.some((e) => e.kind === "dedup"));
});

test("没给输出的调用按空输出处理，提醒照贴", () => {
	const two = repeatSteps(KIMI, 2, () => read());
	const settled = settleStep(KIMI, planStep(two[1]!.state, [read()]), new Map());
	assert.equal(settled.results[0]!.text, REMINDER_1);
});

test("不可变：plan 和 settle 都不改旧状态", () => {
	const before = runStep(KIMI, startTurn(), [read("a")]).state;
	const snapshot = { ...before, seen: new Map(before.seen), history: [...before.history] };
	const plan = planStep(before, [read("b"), read("a")]);
	settleStep(DEFAULT_CONFIG, plan, outputs([]));
	assert.deepEqual(before, snapshot);
});

test("actionFor：自定义阈值", () => {
	const config = { ...KIMI, remind1: 2, remind2: 4, remind3: 6, stopAt: 7 };
	assert.deepEqual([1, 2, 4, 6, 7, 9].map((n) => actionFor(config, n)), ["none", "r1", "r2", "r3", "stop", "stop"]);
});

test("dropHandoff：只有挂起的交接才会被丢弃", () => {
	const twelfth = repeatSteps(KIMI, 12, () => read()).at(-1)!;
	assert.deepEqual(dropHandoff(twelfth.state).events, [{ kind: "handoff", outcome: "dropped" }]);
	assert.equal(dropHandoff(twelfth.state).state.handoff, "done");
	assert.deepEqual(dropHandoff(startTurn()).events, []);
});
