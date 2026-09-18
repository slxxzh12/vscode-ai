// 分发通知（聊天消息 kind:'dist'）的纯逻辑：任务拆分、类型文案、下载地址、游标比较
// 抽成纯函数便于单测；engine.js 只做编排与 IO

// meta 里哪些资产非空 → 要建哪几类任务
export function distKindsOf(meta = {}) {
  const m = meta || {};
  const out = [];
  const hasSkills = ['skills', 'command', 'agent'].some((k) => Array.isArray(m[k]) && m[k].length > 0);
  if (hasSkills) out.push('skills');
  if (Array.isArray(m.workflow) && m.workflow.length > 0) out.push('workflow');
  return out;
}

// 仅用于正文/卡片文案：单类给单类，两类给 mixed，空兜底 skills
export function distTypeOf(meta = {}) {
  const kinds = distKindsOf(meta);
  if (kinds.length >= 2) return 'mixed';
  return kinds[0] || 'skills';
}

// 群主本机共享下载路由；name 含 '/' 时整段编码成单段（服务端按 '/' 切分后再 decodeURIComponent）
export function distUrl(host, port, name) {
  return `http://${host}:${port}/api/collab/downloads/file/${encodeURIComponent(String(name || ''))}`;
}

// 从下载地址解析出 hub 的 { host, port }，用于群记录里 hub 地址过期时回退拉取；非法/非 http(s) 返回 null
export function downloadAddrOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

// 游标过滤：只增不减，同 ts 用 id 去重（重复扫描无副作用，游标只是省事）
export function shouldProcess(cursor, msg) {
  const ts = Number((msg && msg.ts) || 0);
  const lastTs = Number((cursor && cursor.lastTs) || 0);
  if (ts !== lastTs) return ts > lastTs;
  return String((msg && msg.id) || '') !== String((cursor && cursor.lastId) || '');
}
