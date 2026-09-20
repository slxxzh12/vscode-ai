// 四类库的连接与执行。驱动按需 import：不连库时零开销
const READ_SQL = new Set(['SELECT', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN', 'PRAGMA', 'VALUES']);
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i;

function stripSql(s) {
  let t = String(s ?? '').trim();
  for (;;) {
    if (t.startsWith('--')) { const i = t.indexOf('\n'); t = (i < 0 ? '' : t.slice(i + 1)).trim(); continue; }
    if (t.startsWith('/*')) { const i = t.indexOf('*/'); t = (i < 0 ? '' : t.slice(i + 2)).trim(); continue; }
    return t;
  }
}

export function isWriteSql(sql) {
  const stmts = String(sql ?? '').split(';').map(stripSql).filter(Boolean);
  if (!stmts.length) return false;
  return stmts.some((s) => {
    const first = (s.match(/^[A-Za-z]+/)?.[0] || '').toUpperCase();
    if (first === 'WITH') return WRITE_WORDS.test(s);
    return !READ_SQL.has(first);
  });
}

const REDIS_READ = new Set([
  'GET', 'MGET', 'STRLEN', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'KEYS', 'SCAN', 'RANDOMKEY',
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HRANDFIELD',
  'LRANGE', 'LLEN', 'LINDEX', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SRANDMEMBER',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZREVRANGE', 'ZCARD', 'ZSCORE', 'ZRANK',
  'PING', 'ECHO', 'TIME', 'DBSIZE', 'INFO', 'COMMAND', 'GETRANGE', 'BITCOUNT', 'OBJECT',
]);

export function isWriteRedis(argv) {
  const cmd = String(argv?.[0] || '').toUpperCase();
  if (!cmd) return false;
  if (REDIS_READ.has(cmd)) return false;
  if ((cmd === 'CONFIG' || cmd === 'CLIENT') && String(argv?.[1] || '').toUpperCase().startsWith('GET')) return false;
  return true;
}

export function tokenizeRedis(text) {
  const s = String(text ?? '').trim();
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[i + 1]; i += 1; continue; }
      if (ch === quote) { quote = null; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has) out.push(cur);
  return out;
}

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

function capRows(raw, columns, maxRows) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.slice(0, maxRows).map((r) => columns.map((c) => r[c]));
  return { columns, rows, truncated: list.length > maxRows };
}

function withTimeout(promise, ms, code = 'timeout') {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(err(code, 'execution timeout')), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export function createNavicatExec({ connectTimeoutMs = 10000, statementTimeoutMs = 30000, maxRows = 200 } = {}) {
  async function mysqlRun(profile, password, sql) {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: profile.host,
      port: Number(profile.port) || 3306,
      user: profile.user || undefined,
      password: password || undefined,
      database: profile.database || undefined,
      connectTimeout: connectTimeoutMs,
      ssl: profile.options?.ssl ? {} : undefined,
    });
    try {
      const [rows, fields] = await conn.query({ sql, timeout: statementTimeoutMs });
      if (Array.isArray(rows)) {
        const columns = (fields || []).map((f) => f.name);
        const list = rows.slice(0, maxRows).map((r) => columns.map((c) => r[c]));
        return { columns, rows: list, affected: null, truncated: rows.length > maxRows };
      }
      return { columns: [], rows: [], affected: Number(rows?.affectedRows) || 0, truncated: false };
    } finally { await conn.end().catch(() => {}); }
  }

  async function postgresRun(profile, password, sql) {
    const pg = await import('pg');
    const client = new pg.Client({
      host: profile.host,
      port: Number(profile.port) || 5432,
      user: profile.user || undefined,
      password: password || undefined,
      database: profile.database || undefined,
      connectionTimeoutMillis: connectTimeoutMs,
      ssl: profile.options?.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    try {
      await client.query(`SET statement_timeout = ${Number(statementTimeoutMs) || 30000}`);
      const res = await client.query(sql);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      const columns = (one?.fields || []).map((f) => f.name);
      if (columns.length) {
        const list = (one.rows || []).slice(0, maxRows).map((r) => columns.map((c) => r[c]));
        return { columns, rows: list, affected: null, truncated: (one.rows || []).length > maxRows };
      }
      return { columns: [], rows: [], affected: Number(one?.rowCount) || 0, truncated: false };
    } finally { await client.end().catch(() => {}); }
  }

  async function sqliteRun(profile, sql) {
    if (!profile.database) throw err('bad-request', 'database file required');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(profile.database);
    try {
      const stmt = db.prepare(sql);
      if (isWriteSql(sql)) {
        const info = stmt.run();
        return { columns: [], rows: [], affected: Number(info?.changes) || 0, truncated: false };
      }
      const raw = stmt.all();
      const columns = typeof stmt.columns === 'function'
        ? stmt.columns().map((c) => c.name)
        : (raw[0] ? Object.keys(raw[0]) : []);
      return capRows(raw, columns, maxRows);
    } finally { db.close(); }
  }

  async function redisRun(profile, password, command) {
    const { createClient } = await import('redis');
    const argv = tokenizeRedis(command);
    if (!argv.length) throw err('bad-request', 'empty command');
    const client = createClient({
      socket: { host: profile.host, port: Number(profile.port) || 6379, connectTimeout: connectTimeoutMs, tls: profile.options?.ssl || undefined },
      password: password || undefined,
      database: Number(profile.database) || 0,
    });
    client.on('error', () => {});
    await client.connect();
    try {
      const reply = await client.sendCommand(argv);
      return { columns: [], rows: [], affected: null, truncated: false, raw: formatReply(reply) };
    } finally { await client.quit().catch(() => client.disconnect()); }
  }

  function formatReply(reply) {
    if (reply === null || reply === undefined) return '(nil)';
    if (typeof reply === 'string') return reply;
    if (typeof reply === 'number' || typeof reply === 'boolean') return String(reply);
    if (Buffer.isBuffer(reply)) return reply.toString('utf8');
    try { return JSON.stringify(reply, null, 2); } catch { return String(reply); }
  }

  async function run(profile, password, sql) {
    const start = Date.now();
    const body = profile.type === 'mysql' ? mysqlRun(profile, password, sql)
      : profile.type === 'postgres' ? postgresRun(profile, password, sql)
        : profile.type === 'sqlite' ? sqliteRun(profile, sql)
          : profile.type === 'redis' ? redisRun(profile, password, sql)
            : Promise.reject(err('bad-type'));
    const out = await body;
    return { ...out, durationMs: Date.now() - start };
  }

  return {
    isWriteSql,
    isWriteRedis,
    tokenizeRedis,
    isWrite(profile, sql) {
      return profile.type === 'redis' ? isWriteRedis(tokenizeRedis(sql)) : isWriteSql(sql);
    },
    async exec(profile, password, sql) {
      try {
        return await withTimeout(run(profile, password, sql), statementTimeoutMs + connectTimeoutMs);
      } catch (e) {
        if (e && !e.code) e.code = 'exec';
        throw e;
      }
    },
    async test(profile, password) {
      try {
        await withTimeout(run(profile, password, profile.type === 'redis' ? 'PING' : 'SELECT 1'), connectTimeoutMs + 5000);
        return { ok: true };
      } catch (e) {
        if (e && !e.code) e.code = 'connect';
        throw e;
      }
    },
  };
}
