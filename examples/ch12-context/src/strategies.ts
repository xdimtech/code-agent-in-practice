import { EMPTY_CACHE, simulate, summarize, type CacheResult, type CacheState, type RunSummary } from "./cache.ts";
import type { BeforeAgentStartHandler, ContextHandler, Named } from "./inject.ts";
import { EMPTY_SESSION, runTurn, type SessionState } from "./session.ts";
import type { ToolDef } from "./types.ts";

/** 会变的环境信息：每 3 轮变一次（比如未提交文件数）。 */
export function envLine(turn: number): string {
  return `<env>branch: main; uncommitted: ${Math.floor((turn - 1) / 3)}</env>`;
}

export interface Strategy {
  readonly name: string;
  readonly beforeAgentStart?: (turn: number) => readonly Named<BeforeAgentStartHandler>[];
  readonly context?: (turn: number) => readonly Named<ContextHandler>[];
  /** 环境信息写死在基础 system prompt 里（构建时一次性拍快照）。 */
  readonly snapshotInSystem?: boolean;
}

const message = (turn: number): Named<BeforeAgentStartHandler> => ({ name: "env-message", handler: () => ({ message: { customType: "env", content: envLine(turn) } }) });

export const STRATEGIES: readonly Strategy[] = [
  { name: "不注入环境信息" },
  { name: "构建时快照进 system", snapshotInSystem: true },
  { name: "每轮改 system prompt", beforeAgentStart: (turn) => [{ name: "env-system", handler: (e) => ({ systemPrompt: `${e.systemPrompt}\n\n${envLine(turn)}` }) }] },
  { name: "每轮注入持久消息", beforeAgentStart: (turn) => [message(turn)] },
  { name: "变了才注入持久消息", beforeAgentStart: (turn) => (turn === 1 || envLine(turn) !== envLine(turn - 1) ? [message(turn)] : []) },
  { name: "context 钩子尾部注入", context: (turn) => [{ name: "env-tail", handler: (messages) => [...messages, { role: "user", content: envLine(turn), customType: "env" }] }] },
];

export interface StrategyRun extends RunSummary {
  readonly name: string;
  /** 请求里看不到当前环境信息（或看到的是旧值）的轮数。 */
  readonly staleTurns: number;
  /** 最后会话历史里留下的注入消息条数。 */
  readonly injectedInHistory: number;
}

export interface Scenario {
  readonly tools: readonly ToolDef[];
  readonly baseSystemPrompt: string;
  readonly prompts: readonly string[];
}

interface Acc {
  readonly cache: CacheState;
  readonly session: SessionState;
  readonly results: readonly CacheResult[];
  readonly stale: number;
}

export function runStrategy(strategy: Strategy, scenario: Scenario): StrategyRun {
  const baseSystemPrompt = strategy.snapshotInSystem ? `${scenario.baseSystemPrompt}\n\n${envLine(1)}` : scenario.baseSystemPrompt;
  const final = scenario.prompts.reduce<Acc>(
    (acc, prompt, index) => {
      const turn = index + 1;
      const config = {
        tools: scenario.tools,
        baseSystemPrompt,
        beforeAgentStart: strategy.beforeAgentStart?.(turn),
        context: strategy.context?.(turn),
        reply: (n: number) => `好的，第 ${n} 个问题处理完了，改动见上面的 diff。`,
      };
      const { request, state } = runTurn(config, acc.session, prompt);
      const { cache, result } = simulate(acc.cache, request);
      const visible = [request.system, ...request.messages.map((m) => m.content)].join("\n");
      const fresh = latestEnv(visible) === envLine(turn);
      return { cache, session: state, results: [...acc.results, result], stale: acc.stale + (fresh ? 0 : 1) };
    },
    { cache: EMPTY_CACHE, session: EMPTY_SESSION, results: [], stale: 0 },
  );
  return {
    name: strategy.name,
    ...summarize(final.results),
    staleTurns: final.stale,
    injectedInHistory: final.session.history.filter((m) => m.customType === "env").length,
  };
}

/** 模型看到的「当前」环境信息是请求里最后出现的那一条。 */
function latestEnv(text: string): string | undefined {
  return text.match(/<env>[^<]*<\/env>/g)?.at(-1);
}
