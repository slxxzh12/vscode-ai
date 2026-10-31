import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

export function localDayKey(ts) {
  const n = Number(ts) || 0;
  if (n <= 0) return '';
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const monthOf = (day) => String(day || '').slice(0, 7);

export function createInputStats({ file, logger = console } = {}) {
  let data = { version: VERSION, seeded: false, users: {} };
  try {
    if (file && fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && typeof j === 'object' && j.users && typeof j.users === 'object') {
        data = { version: VERSION, seeded: !!j.seeded, users: j.users };
      }
    }
  } catch (e) {
    logger?.warn?.('input stats load failed', (e && e.message) || e);
  }

  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      logger?.warn?.('input stats save failed', (e && e.message) || e);
    }
  }

  function ensureUser(userId, userName) {
    const id = String(userId || '');
    if (!data.users[id]) data.users[id] = { name: '', days: {} };
    const u = data.users[id];
    if (!u.days || typeof u.days !== 'object') u.days = {};
    if (userName && !u.name) u.name = String(userName);
    return u;
  }

  function bump(userId, userName, day, messages, chars) {
    if (!day) return;
    const u = ensureUser(userId, userName);
    if (!u.days[day]) u.days[day] = { messages: 0, chars: 0 };
    const d = u.days[day];
    d.messages = (Number(d.messages) || 0) + messages;
    d.chars = (Number(d.chars) || 0) + chars;
  }

  return {
    seeded: () => !!data.seeded,
    record({ userId = '', userName = '', ts = Date.now(), chars = 0 } = {}) {
      const day = localDayKey(ts) || localDayKey(Date.now());
      const n = Math.max(0, Math.round(Number(chars) || 0));
      bump(userId, userName, day, 1, n);
      save();
    },
    recordMany({ userId = '', userName = '', events = [] } = {}) {
      let changed = false;
      for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const day = localDayKey(Number(ev.ts) || Date.now());
        const n = Math.max(0, Math.round(Number(ev.chars) || 0));
        bump(userId, userName, day, 1, n);
        changed = true;
      }
      if (changed) save();
    },
    seed(days = []) {
      if (data.seeded) return;
      for (const d of days || []) {
        if (!d || !d.day) continue;
        bump(d.userId, d.userName, d.day, Math.max(0, Math.round(Number(d.messages) || 0)), Math.max(0, Math.round(Number(d.chars) || 0)));
      }
      data.seeded = true;
      save();
    },
    summary() {
      const users = [];
      const days = [];
      const months = new Map();
      let totalMessages = 0;
      let totalChars = 0;
      for (const [userId, u] of Object.entries(data.users || {})) {
        let um = 0;
        let uc = 0;
        const name = String(u?.name || '');
        for (const [day, d] of Object.entries(u?.days || {})) {
          const m = Number(d?.messages) || 0;
          const c = Number(d?.chars) || 0;
          if (!m && !c) continue;
          um += m;
          uc += c;
          days.push({ userId, userName: name, day, messages: m, chars: c });
          const mk = monthOf(day);
          if (!mk) continue;
          const key = `${userId}\u0000${mk}`;
          if (!months.has(key)) months.set(key, { userId, userName: name, month: mk, messages: 0, chars: 0 });
          const mo = months.get(key);
          mo.messages += m;
          mo.chars += c;
        }
        if (!um && !uc) continue;
        users.push({ userId, userName: name, messages: um, chars: uc, sessions: 0, firstTs: 0, lastTs: 0 });
        totalMessages += um;
        totalChars += uc;
      }
      days.sort((a, b) => a.day.localeCompare(b.day));
      return {
        users,
        days,
        months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
        totals: { messages: totalMessages, chars: totalChars, users: users.length },
      };
    },
  };
}
