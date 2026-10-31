import { readHistory } from './message-history.js';

export const NO_SESSION = '';

export function monthKey(ts) {
  const n = Number(ts) || 0;
  if (n <= 0) return '';
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayKey(ts) {
  const n = Number(ts) || 0;
  if (n <= 0) return '';
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// files: [{ file, userId, userName, projectId }]
export function summarizeHistory(files = []) {
  const sessions = new Map();
  const months = new Map();
  const days = new Map();
  const users = new Map();
  let totalMessages = 0;
  let totalChars = 0;

  const ensureUser = (userId, userName) => {
    if (!users.has(userId)) users.set(userId, { userId, userName, messages: 0, chars: 0, sessions: new Set(), firstTs: 0, lastTs: 0 });
    const u = users.get(userId);
    if (!u.userName && userName) u.userName = userName;
    return u;
  };

  for (const f of files || []) {
    const userId = String(f?.userId || '');
    const userName = String(f?.userName || '');
    const projectId = String(f?.projectId || '');
    const list = readHistory(f?.file);
    for (const m of list) {
      const text = String(m.text || '');
      const chars = text.length;
      const ts = Number(m.ts) || 0;
      const sessionId = String(m.sessionId || '');
      const tabName = String(m.tabName || '');
      const sessionKey = `${userId}\u0000${sessionId || tabName}`;

      if (!sessions.has(sessionKey)) {
        sessions.set(sessionKey, {
          userId, userName, projectId, sessionId, tabName,
          messages: 0, chars: 0, firstTs: ts, lastTs: ts,
        });
      }
      const s = sessions.get(sessionKey);
      s.messages += 1;
      s.chars += chars;
      if (ts > 0) {
        if (!s.firstTs || ts < s.firstTs) s.firstTs = ts;
        if (ts > s.lastTs) s.lastTs = ts;
      }

      const mk = monthKey(ts);
      const monthFull = `${userId}\u0000${mk}`;
      if (!months.has(monthFull)) months.set(monthFull, { userId, userName, month: mk, messages: 0, chars: 0 });
      const mo = months.get(monthFull);
      mo.messages += 1;
      mo.chars += chars;

      const dk = dayKey(ts);
      if (dk) {
        const dayFull = `${userId}\u0000${dk}`;
        if (!days.has(dayFull)) days.set(dayFull, { userId, userName, day: dk, messages: 0, chars: 0 });
        const da = days.get(dayFull);
        da.messages += 1;
        da.chars += chars;
      }

      const u = ensureUser(userId, userName);
      u.messages += 1;
      u.chars += chars;
      u.sessions.add(sessionId || tabName || NO_SESSION);
      if (ts > 0) {
        if (!u.firstTs || ts < u.firstTs) u.firstTs = ts;
        if (ts > u.lastTs) u.lastTs = ts;
      }

      totalMessages += 1;
      totalChars += chars;
    }
  }

  const userRows = [...users.values()]
    .map((u) => ({ ...u, sessions: u.sessions.size }))
    .sort((a, b) => b.messages - a.messages || a.userName.localeCompare(b.userName));
  const sessionRows = [...sessions.values()]
    .sort((a, b) => b.lastTs - a.lastTs || b.messages - a.messages);
  const monthRows = [...months.values()]
    .sort((a, b) => b.month.localeCompare(a.month) || a.userName.localeCompare(b.userName));
  const dayRows = [...days.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.userName.localeCompare(b.userName));

  return {
    totals: { messages: totalMessages, chars: totalChars, sessions: sessionRows.length, users: userRows.length },
    users: userRows,
    sessions: sessionRows,
    months: monthRows,
    days: dayRows,
  };
}
