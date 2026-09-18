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
