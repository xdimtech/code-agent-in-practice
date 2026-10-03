/**
 * 把回答和规则对起来。纯函数，不读文件、不联网。
 *
 * 输出的顺序永远是 ROUTE_IDS 的固定顺序，和回答无关——这是故意的：
 * 一旦按「排除得少」「义务少」排序，就等于偷偷打了分。留下几条路就列几条，谁更合适由你看义务清单决定。
 */

import { QUESTIONS, RULES } from "./questions.ts";
import { routeOf } from "./routes.ts";
import type { Answers, Finding, QuestionId, Rule, Verdict } from "./types.ts";
import { ROUTE_IDS } from "./types.ts";

/**
 * 校验回答：问题必须存在，值必须在封闭选项里。
 * 拼错的值不能被当成「没回答」悄悄放过——那会让本该排除的路线留下来。
 */
export function validateAnswers(raw: Readonly<Record<string, string>>): Answers {
	const answers: Partial<Record<QuestionId, string>> = {};
	for (const [key, value] of Object.entries(raw)) {
		const question = QUESTIONS.find((q) => q.id === key);
		if (question === undefined) {
			throw new Error(`没有这个问题：--${key}。可用的问题：${QUESTIONS.map((q) => q.id).join("、")}`);
		}
		if (!Object.hasOwn(question.options, value)) {
			throw new Error(`--${key} 的值只能是 ${Object.keys(question.options).join(" / ")}，收到「${value}」`);
		}
		answers[question.id] = value;
	}
	return answers;
}

/** when 里的每一项都要回答了、并且命中；没回答的问题不匹配 */
export function ruleMatches(rule: Rule, answers: Answers): boolean {
	const conditions = Object.entries(rule.when) as [QuestionId, readonly string[]][];
	if (conditions.length === 0) throw new Error(`规则没有条件：${rule.route} / ${rule.reason}`);
	return conditions.every(([question, values]) => {
		const answer = answers[question];
		return answer !== undefined && values.includes(answer);
	});
}

function findingOf(rule: Rule): Finding {
	return { questions: Object.keys(rule.when) as QuestionId[], reason: rule.reason, evidence: rule.evidence };
}

export function filterRoutes(answers: Answers, rules: readonly Rule[] = RULES): readonly Verdict[] {
	return ROUTE_IDS.map((id) => {
		const route = routeOf(id);
		const hits = rules.filter((rule) => rule.route === id && ruleMatches(rule, answers));
		const exclusions = hits.filter((rule) => rule.effect === "exclude").map(findingOf);
		const fromAnswers = hits.filter((rule) => rule.effect === "obligation").map(findingOf);
		const fromRoute: readonly Finding[] = route.ownership.map((fact) => ({ questions: [], reason: fact.text, evidence: fact.evidence }));
		return {
			route,
			status: exclusions.length > 0 ? "excluded" : "viable",
			exclusions,
			obligations: [...fromAnswers, ...fromRoute],
		};
	});
}
