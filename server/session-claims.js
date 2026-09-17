// 会话续接认领：避免多个 devflow 会话抢占同一个 agent 对话（同一 opencode session）。
export function claimedAgentSessionIds(records, exceptDevflowId = null) {
  const out = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.id === exceptDevflowId) continue;
    if (typeof r.agentSessionId === 'string' && r.agentSessionId) out.add(r.agentSessionId);
  }
  return out;
}

export function findClaimOwner(liveSessions, records, agentSessionId, exceptDevflowId = null) {
  if (!agentSessionId) return null;
  const byId = new Map();
  for (const r of Array.isArray(records) ? records : []) if (r && r.id) byId.set(r.id, r);
  for (const s of Array.isArray(liveSessions) ? liveSessions : []) {
    if (!s || !s.id || s.id === exceptDevflowId || s.state !== 'running') continue;
    const rec = byId.get(s.id);
    if (rec && rec.agentSessionId === agentSessionId) return s;
  }
  return null;
}
