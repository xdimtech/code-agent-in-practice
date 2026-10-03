import type { Merge } from "./types.ts";

// 把 pi runner 的 12 种合并方式写成纯函数。处理函数的行为是数据，不是代码：
//   returns：返回一个值；throws：抛错；mutates：就地改事件对象（可选地改完再抛错）。
// 每种合并对应 runner.ts 的一个 emitXxx 方法，行号见 types.ts 里 MERGES 的注释。

export type Behavior =
  | { readonly kind: "returns"; readonly value: unknown }
  | { readonly kind: "throws"; readonly message: string }
  | { readonly kind: "mutates"; readonly patch: Readonly<Record<string, unknown>>; readonly thenThrows?: string };

export interface Handler {
  /** 哪个扩展注册的；扩展按加载顺序排，同一扩展里按注册顺序 */
  readonly ext: string;
  readonly does: Behavior;
}

export interface MergeResult {
  /** 宿主最后用上的东西；notify 永远是 undefined */
  readonly outcome: unknown;
  /** 实际被调用的处理函数，短路之后的不在里面 */
  readonly called: readonly string[];
  /** 被 runner 接住、记成扩展错误的那些 */
  readonly errors: readonly string[];
  /** 没被 runner 接住、抛给宿主的错误（只有 tool_call 会这样） */
  readonly threw?: string;
}

type Rec = Readonly<Record<string, unknown>>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (v: unknown, k: string): unknown => (isRec(v) ? v[k] : undefined);

/** 就地修改在模拟里表现为返回一份新对象；null 表示删除这个键（before_provider_headers 的约定，docs/extensions.md:691） */
function applyPatch(target: unknown, patch: Rec): Rec {
  const base: Record<string, unknown> = { ...(isRec(target) ? target : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** 一步：调用一个处理函数。抛错时 value 为 undefined、error 有值；mutates 的修改在抛错之前已经生效 */
interface Step {
  readonly value: unknown;
  readonly error?: string;
  readonly mutated?: Rec;
}

function call(h: Handler, current: unknown): Step {
  const d = h.does;
  if (d.kind === "returns") return { value: d.value };
  if (d.kind === "throws") return { value: undefined, error: d.message };
  const mutated = applyPatch(current, d.patch);
  return d.thenThrows === undefined ? { value: undefined, mutated } : { value: undefined, error: d.thenThrows, mutated };
}

const tag = (h: Handler, msg: string) => `${h.ext}: ${msg}`;

type Sim = (handlers: readonly Handler[], initial: unknown) => MergeResult;

/** notify：返回值一律忽略，每个处理函数单独 try/catch */
const notify: Sim = (handlers) => {
  const errors = handlers.flatMap((h) => {
    const s = call(h, undefined);
    return s.error === undefined ? [] : [tag(h, s.error)];
  });
  return { outcome: undefined, called: handlers.map((h) => h.ext), errors };
};

/** cancel：session_before_*；第一个 cancel 短路，否则最后一个非空结果胜出 */
const cancel: Sim = (handlers) => {
  let result: unknown;
  const called: string[] = [];
  const errors: string[] = [];
  for (const h of handlers) {
    called.push(h.ext);
    const s = call(h, undefined);
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (s.value) {
      result = s.value;
      if (field(result, "cancel") === true) break;
    }
  }
  return { outcome: result, called, errors };
};

/** first-decided：project_trust；不是 undecided 的第一个胜出。返回 undefined 会在读 .trusted 时抛 TypeError */
const firstDecided: Sim = (handlers) => {
  const called: string[] = [];
  const errors: string[] = [];
  for (const h of handlers) {
    called.push(h.ext);
    const s = call(h, undefined);
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (!isRec(s.value)) errors.push(tag(h, "TypeError: Cannot read properties of undefined (reading 'trusted')"));
    else if (s.value.trusted !== "undecided") return { outcome: s.value, called, errors };
  }
  return { outcome: undefined, called, errors };
};

const PATH_KINDS = ["skillPaths", "promptPaths", "themePaths"] as const;

/** collect：resources_discover；三类路径都收集起来，记上是哪个扩展给的 */
const collect: Sim = (handlers) => {
  const errors: string[] = [];
  const found: Array<{ kind: string; path: string; ext: string }> = [];
  for (const h of handlers) {
    const s = call(h, undefined);
    if (s.error !== undefined) {
      errors.push(tag(h, s.error));
      continue;
    }
    for (const kind of PATH_KINDS) {
      const paths = field(s.value, kind);
      if (Array.isArray(paths)) found.push(...paths.map((p) => ({ kind, path: String(p), ext: h.ext })));
    }
  }
  return { outcome: found, called: handlers.map((h) => h.ext), errors };
};

/** chain：before_provider_request；返回值不是 undefined 就成为下一个处理函数看到的值。抛错的那一份改写丢失 */
const chain: Sim = (handlers, initial) => {
  let current = initial;
  const errors: string[] = [];
  for (const h of handlers) {
    const s = call(h, current);
    if (s.mutated !== undefined) current = s.mutated;
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (s.value !== undefined) current = s.value;
  }
  return { outcome: current, called: handlers.map((h) => h.ext), errors };
};

/** in-place：before_provider_headers；返回值忽略，只有就地修改算数——哪怕改完又抛错 */
const inPlace: Sim = (handlers, initial) => {
  let current = initial;
  const errors: string[] = [];
  for (const h of handlers) {
    const s = call(h, current);
    if (s.mutated !== undefined) current = s.mutated;
    if (s.error !== undefined) errors.push(tag(h, s.error));
  }
  return { outcome: current, called: handlers.map((h) => h.ext), errors };
};

/** prompt：before_agent_start；message 累加，systemPrompt 串联（后一个看到前一个改过的） */
const prompt: Sim = (handlers, initial) => {
  let systemPrompt = field(initial, "systemPrompt");
  let modified = false;
  const messages: unknown[] = [];
  const errors: string[] = [];
  for (const h of handlers) {
    const s = call(h, undefined);
    if (s.error !== undefined) {
      errors.push(tag(h, s.error));
      continue;
    }
    if (field(s.value, "message") !== undefined) messages.push(field(s.value, "message"));
    if (field(s.value, "systemPrompt") !== undefined) {
      systemPrompt = field(s.value, "systemPrompt");
      modified = true;
    }
  }
  const outcome = messages.length > 0 || modified ? { messages: messages.length > 0 ? messages : undefined, systemPrompt: modified ? systemPrompt : undefined } : undefined;
  return { outcome, called: handlers.map((h) => h.ext), errors };
};

/** same-role：message_end；串联替换，换了 role 的结果被拒（记一条错误，保留之前的消息） */
const sameRole: Sim = (handlers, initial) => {
  let current = initial;
  let modified = false;
  const errors: string[] = [];
  for (const h of handlers) {
    const s = call(h, undefined);
    const next = field(s.value, "message");
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (next === undefined) continue;
    else if (field(next, "role") !== field(current, "role")) errors.push(tag(h, "message_end handlers must return a message with the same role"));
    else {
      current = next;
      modified = true;
    }
  }
  return { outcome: modified ? current : undefined, called: handlers.map((h) => h.ext), errors };
};

const RESULT_FIELDS = ["content", "details", "isError", "usage"] as const;

/** per-field：tool_result；四个字段各自串联，只返回想改的字段即可 */
const perField: Sim = (handlers, initial) => {
  let current: Rec = isRec(initial) ? initial : {};
  let modified = false;
  const errors: string[] = [];
  for (const h of handlers) {
    const s = call(h, undefined);
    if (s.error !== undefined) {
      errors.push(tag(h, s.error));
      continue;
    }
    const changes = Object.fromEntries(RESULT_FIELDS.filter((k) => field(s.value, k) !== undefined).map((k) => [k, field(s.value, k)]));
    if (Object.keys(changes).length > 0) {
      current = { ...current, ...changes };
      modified = true;
    }
  }
  return { outcome: modified ? current : undefined, called: handlers.map((h) => h.ext), errors };
};

/**
 * block：tool_call；runner 不 catch。第一个 block 短路；抛错一路抛到 agent-loop 的 prepareToolCall，
 * 在那里变成一条错误结果——效果等于拦下。就地改 input 是改参数的唯一办法。
 */
const block: Sim = (handlers, initial) => {
  let input = initial;
  let result: unknown;
  const called: string[] = [];
  for (const h of handlers) {
    called.push(h.ext);
    const s = call(h, input);
    if (s.mutated !== undefined) input = s.mutated;
    if (s.error !== undefined) return { outcome: { blocked: true, reason: s.error, input }, called, errors: [], threw: tag(h, s.error) };
    if (s.value) {
      result = s.value;
      if (field(result, "block") === true) return { outcome: { blocked: true, reason: field(result, "reason"), input }, called, errors: [] };
    }
  }
  return { outcome: { blocked: false, input }, called, errors: [] };
};

/** first-result：user_bash；第一个非空结果胜出，后面的处理函数不再被调用 */
const firstResult: Sim = (handlers) => {
  const called: string[] = [];
  const errors: string[] = [];
  for (const h of handlers) {
    called.push(h.ext);
    const s = call(h, undefined);
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (s.value) return { outcome: s.value, called, errors };
  }
  return { outcome: undefined, called, errors };
};

/** transform：input；transform 串联，handled 短路；什么都没改就是 continue */
const transform: Sim = (handlers, initial) => {
  const original = String(initial);
  let text = original;
  const called: string[] = [];
  const errors: string[] = [];
  for (const h of handlers) {
    called.push(h.ext);
    const s = call(h, undefined);
    const action = field(s.value, "action");
    if (s.error !== undefined) errors.push(tag(h, s.error));
    else if (action === "handled") return { outcome: s.value, called, errors };
    else if (action === "transform") text = String(field(s.value, "text"));
  }
  return { outcome: text !== original ? { action: "transform", text } : { action: "continue" }, called, errors };
};

const SIMS: Readonly<Record<Merge, Sim>> = {
  notify,
  cancel,
  "first-decided": firstDecided,
  collect,
  chain,
  "in-place": inPlace,
  prompt,
  "same-role": sameRole,
  "per-field": perField,
  block,
  "first-result": firstResult,
  transform,
};

/** 按 merge 方式跑一组处理函数。initial 是事件里会被改的那部分：payload、headers、input 文本、消息、工具结果…… */
export function simulate(merge: Merge, handlers: readonly Handler[], initial?: unknown): MergeResult {
  return SIMS[merge](handlers, initial);
}

export const returns = (ext: string, value: unknown): Handler => ({ ext, does: { kind: "returns", value } });
export const throws = (ext: string, message: string): Handler => ({ ext, does: { kind: "throws", message } });
export const mutates = (ext: string, patch: Rec, thenThrows?: string): Handler => ({ ext, does: thenThrows === undefined ? { kind: "mutates", patch } : { kind: "mutates", patch, thenThrows } });
