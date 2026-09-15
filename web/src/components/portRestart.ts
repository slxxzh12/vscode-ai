export interface PortRuntimeState {
  restartable?: boolean;
  portSource?: 'env' | 'file' | 'default' | string;
}

export function canRestart(s: PortRuntimeState): boolean {
  return s.restartable === true;
}

// 不可重启时给出原因词条；可重启返回空串
export function restartHintKey(s: PortRuntimeState): string {
  if (canRestart(s)) return '';
  return s.portSource === 'env' ? 'term.port_restart_pinned' : 'term.port_restart_notpackaged';
}

export type ConfirmPlan =
  | { action: 'close' }
  | { action: 'restart'; port: number }
  | { action: 'blocked'; hintKey: string };

// 「确定」= 保存并立即生效：端口变了才重启（没变就只关面板，避免白杀会话）
export function planConfirm({ port, loadedPort, state }: { port: number | null; loadedPort: number | null; state: PortRuntimeState }): ConfirmPlan {
  const valid = typeof port === 'number' && Number.isFinite(port) && port >= 1 && port <= 65535;
  if (port !== loadedPort) {
    if (!valid) return { action: 'blocked', hintKey: 'term.port_invalid' };
    if (!canRestart(state)) return { action: 'blocked', hintKey: restartHintKey(state) };
    return { action: 'restart', port };
  }
  return { action: 'close' };
}
