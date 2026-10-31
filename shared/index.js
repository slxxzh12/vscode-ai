// 代理相关默认端口：LLM 中转独立监听、Nginx 反向代理默认规则
export const LLM_RELAY_DEFAULT_PORT = 22223;
export const NGINX_DEFAULT_PORT = 22224;
export const NGINX_SAMPLE_REWRITES = Object.freeze([
  Object.freeze({ from: '/rest/v1', to: '/v1' }),
  Object.freeze({ from: '/v2', to: '/v1' }),
]);

export const C2S = Object.freeze({
  LIST: 'list', CREATE: 'create', START: 'start', INPUT: 'input',
  RESIZE: 'resize', STOP: 'stop', KILL: 'kill', PING: 'ping', RESTORE: 'restore',
  WF_LIST: 'wf-list', WF_RUN: 'wf-run', WF_NEXT: 'wf-next', WF_ABORT: 'wf-abort',
  WF_ROLLBACK: 'wf-rollback',
});
export const S2C = Object.freeze({
  OUTPUT: 'output', REPLAY: 'replay', SESSION_CREATED: 'session-created',
  SESSION_LIST: 'session-list', SESSION_EXITED: 'session-exited',
  ERROR: 'error', PONG: 'pong',
  WF_LIST_RESULT: 'wf-list-result', WF_STARTED: 'wf-started',
  WF_STATUS: 'wf-status', WF_FINISHED: 'wf-finished',
  CONFIG_CHANGED: 'config-changed',
});
