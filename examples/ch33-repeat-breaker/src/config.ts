/**
 * 配置。默认值就是 kimi-code 的四个常量（3 / 5 / 8 / 12），外加本例的交替检测。
 *
 * 配置来自命令行或文件，属于外部输入：阈值必须是正整数且严格递增，否则直接报错——
 * 断路器配错了是用法问题，不能悄悄退回默认值，那样用户会以为自己的阈值在生效。
 */

export interface CycleConfig {
	readonly enabled: boolean;
	/** 一组最多几个调用。1 个的情况就是连续重复，归主计数管 */
	readonly maxPeriod: number;
	/** 原样重复几遍才提醒 */
	readonly repeats: number;
}

export interface BreakerConfig {
	readonly remind1: number;
	readonly remind2: number;
	readonly remind3: number;
	readonly stopAt: number;
	readonly cycle: CycleConfig;
	/** 每轮步数上限；undefined 表示不设——kimi-code 的默认就是不设 */
	readonly maxSteps?: number;
}

export const KIMI_THRESHOLDS = { remind1: 3, remind2: 5, remind3: 8, stopAt: 12 } as const;

export const DEFAULT_CONFIG: BreakerConfig = {
	...KIMI_THRESHOLDS,
	cycle: { enabled: true, maxPeriod: 3, repeats: 3 },
};

export class ConfigError extends Error {}

export function validateConfig(config: BreakerConfig): BreakerConfig {
	const levels = [config.remind1, config.remind2, config.remind3, config.stopAt];
	if (!levels.every((n) => Number.isInteger(n) && n >= 2)) throw new ConfigError("提醒与停止的阈值都要是不小于 2 的整数");
	if (!levels.every((n, i) => i === 0 || n > levels[i - 1]!)) throw new ConfigError("阈值要严格递增：remind1 < remind2 < remind3 < stopAt");
	const { maxPeriod, repeats } = config.cycle;
	if (!Number.isInteger(maxPeriod) || maxPeriod < 2) throw new ConfigError("cycle.maxPeriod 要是不小于 2 的整数");
	if (!Number.isInteger(repeats) || repeats < 2) throw new ConfigError("cycle.repeats 要是不小于 2 的整数");
	if (config.maxSteps !== undefined && (!Number.isInteger(config.maxSteps) || config.maxSteps < 1)) {
		throw new ConfigError("maxSteps 要是正整数");
	}
	return config;
}
