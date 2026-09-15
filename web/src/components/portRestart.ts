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
