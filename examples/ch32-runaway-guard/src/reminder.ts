/**
 * 提醒文案。每一条都以同一句话收尾：这是一次性的运行时提醒，不要写进记忆。
 *
 * 那句话针对的是「有记忆的 agent」特有的问题：模型把一次纠偏当成用户偏好存下来，
 * 以后每一轮都照着做。
 */

import type { RemindableKind } from "./types.ts";

export const NOT_A_RULE =
	"This is a temporary runtime reminder for the current turn only, not a user preference or a durable rule; do not save it into memory, skills, or other persistent instruction files.";

export function reminderText(signal: RemindableKind, occurrences: number): string {
	const body = {
		no_progress: `Verified progress for the same target has stayed unchanged across ${occurrences} attempts. Do not continue the same route without a concrete expected state change; inspect the current state, change strategy, or explain the blocker.`,
		error_family: `The same tool error family has occurred ${occurrences} times in a row. Do not retry the same route unchanged; diagnose the cause, change one variable, or switch route.`,
		action_repeat: `The same tool call with the same arguments has occurred ${occurrences} times. Do not repeat it unchanged; use the results you already have, change strategy, or report the blocker.`,
		polling_repeat: `${occurrences} polls of the same task returned the same answer. Stop polling; you will be notified when the task finishes.`,
	}[signal];
	return `[runaway guard] ${body} ${NOT_A_RULE}`;
}
