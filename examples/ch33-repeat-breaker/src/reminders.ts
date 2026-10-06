/**
 * 提醒文案。kimi-code 的三段原文是英文，这里是意译，结构不变：
 *
 * - 第一级：先写一句「下一次调用指望得到什么新信息」；
 * - 第二级：三选一——找一个能推翻当前思路的最便宜的检查 / 向用户要缺的输入 / 用已有证据收尾；
 * - 第三级：现在就写最终回复，不再调工具，只写字。
 *
 * 提醒贴在工具结果的后面，不是另起一条消息：模型读结果时一定会读到它。
 */

export const REMINDER_1 =
	"\n\n<system-reminder>同一个工具调用已经连续重复了好几次。下一次调用之前，先写一句话说明你指望它带来什么新信息；" +
	"如果这句话说出了当前结果没给你的东西，就选最能拿到它的动作，否则用已有的证据继续。</system-reminder>";

export function reminder2(streak: number): string {
	return (
		`\n\n<system-reminder>同一个工具调用已经连续发出 ${streak} 次。从下面三项里选一项，先说出你的选择再行动：\n` +
		"(1) 证伪：如果存在一个能明确推翻当前思路的检查，跑最便宜的那个；\n" +
		"(2) 缺输入：准确告诉用户你需要什么信息或决定才能继续，并向他们要；\n" +
		"(3) 收尾：基于已经拿到的证据给出最好的结果，列出仍不确定的部分。</system-reminder>"
	);
}

export const REMINDER_3 =
	"\n\n<system-reminder>现在写最终回复，不要再调用任何工具。写清楚：当前卡在哪、试过的每一种做法各自确认了什么、" +
	"要继续需要用户提供什么信息或决定。只写文字。</system-reminder>";

export function handoffVeto(stopAt: number): string {
	return (
		`这一轮已经被断路器结束：同一个工具调用连续发出了 ${stopAt} 次。这一步只接受文字回复，所以这次工具调用没有执行。` +
		"请用文字回复：当前卡在哪、试过什么、接下来需要什么。"
	);
}

/** 本例新增：交替打转的提醒。kimi-code 没有这一条 */
export function cycleReminder(period: number, repeats: number): string {
	return (
		`\n\n<system-reminder>最近的工具调用以 ${period} 个为一组、原样重复了 ${repeats} 遍。` +
		"这通常是在两个状态之间来回切换。下一次调用之前，先写一句话说明这一组调用每次带来了什么不同。</system-reminder>"
	);
}
