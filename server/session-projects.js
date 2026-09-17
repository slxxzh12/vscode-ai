import { createJsonStore } from './json-store.js';

// sessionId → projectId 映射。用途：服务端重启后 PTY 全没、sessionId 全部失效，
// 靠这份映射仍能把历史消息（message-history.jsonc）归属到项目，供前端「当前项目」筛选。
// 只增不删（会话被 kill 也不清——消息还在，仍需归属），上限 MAX_SESSIONS 淘汰最旧。
export const MAX_SESSIONS = 500;

export function normalizeSessionProjects(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof k === 'string' && k && typeof v === 'string' && v) out[k] = v;
  }
  const keys = Object.keys(out);
  if (keys.length > MAX_SESSIONS) {
    for (const k of keys.slice(0, keys.length - MAX_SESSIONS)) delete out[k];
  }
  return out;
}

export function createSessionProjects({ file = null, logger = console } = {}) {
  const store = createJsonStore({ file, logger, normalize: normalizeSessionProjects, defaults: () => ({}) });
  // 记录一条映射；空值跳过，同值不写盘（幂等）。
  function record(sessionId, projectId) {
    const cur = store.read();
    if (typeof sessionId !== 'string' || !sessionId) return cur;
    if (typeof projectId !== 'string' || !projectId) return cur;
    if (cur[sessionId] === projectId) return cur;
    return store.write({ ...cur, [sessionId]: projectId });
  }
  return { read: store.read, record };
}
