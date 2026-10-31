// 新建 Agent 会话后判断 CLI 是否就绪：最短时长 + 输出静默，超时放弃。
export type GateState = 'waiting' | 'ready' | 'timeout';

export interface ReadyGateOptions {
  now: () => number;
  minMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

export function createReadyGate(opts: ReadyGateOptions): { output(): void; poll(): GateState } {
  const minMs = opts.minMs ?? 3000;
  const quietMs = opts.quietMs ?? 1200;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const start = opts.now();
  let last = start;
  return {
    output() { last = opts.now(); },
    poll(): GateState {
      const t = opts.now();
      if (t - start >= timeoutMs) return 'timeout';
      if (t - start >= minMs && t - last >= quietMs) return 'ready';
      return 'waiting';
    },
  };
}

// —— 向 Agent（opencode TUI）脚本化发 /rename 时的屏幕断言 ——
// 背景：/rename 是「会话已开始对话」才注册的斜杠命令；新会话（还没聊过）里面板根本没有它，
// 此时盲发 `/rename` + 回车会命中面板里另一个命令，之后盲输的名字还会被当成对话消息发给模型。
// 所以每一步都先读终端屏幕确认状态，确认不了就收手（绝不让名字漏进对话）。
const RENAME_SESSION = /rename\s+session/i;
const RENAME_ITEM = /\/rename\b/i;

// 命令面板里出现了可执行的 /rename 项（形如 `/rename    Rename session`）。
export function paletteOffersRename(lines: string[]): boolean {
  return lines.some((l) => RENAME_ITEM.test(l) && RENAME_SESSION.test(l));
}

// 改名输入框已弹出（标题行形如 `Rename Session … esc`，不带斜杠）。
export function renameDialogOpen(lines: string[]): boolean {
  return lines.some((l) => RENAME_SESSION.test(l) && !RENAME_ITEM.test(l));
}

export interface ScreenWaitOptions {
  readScreen: () => string[];
  isActive?: () => boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// 按 pollMs 轮询屏幕，直到 pred 成立（true）／超时或会话切走（false）。
export async function waitForScreen(pred: (lines: string[]) => boolean, opts: ScreenWaitOptions): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const pollMs = opts.pollMs ?? 120;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    if (opts.isActive && !opts.isActive()) return false;
    if (pred(opts.readScreen())) return true;
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
}
