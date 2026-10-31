import { ensureSchema } from './schema.js';

export function isMysqlDuplicate(e) {
  return !!(e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062));
}

export async function createMysqlDriver({ host, port = 3306, user, password, database, logger = console, connectionLimit = 4 }) {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host, port, user, password, database, charset: 'utf8mb4',
    waitForConnections: true, connectionLimit,
  });
  const driver = {
    dialect: 'mysql',
    async exec(sql) { await pool.query(sql); },
    async query(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; },
    async run(sql, params = []) {
      const [r] = await pool.query(sql, params);
      return { changes: Number(r.affectedRows || 0), insertId: Number(r.insertId || 0) };
    },
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const api = {
          async query(sql, params = []) { const [rows] = await conn.query(sql, params); return rows; },
          async run(sql, params = []) {
            const [r] = await conn.query(sql, params);
            return { changes: Number(r.affectedRows || 0), insertId: Number(r.insertId || 0) };
          },
        };
        const out = await fn(api);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
    isDuplicate: isMysqlDuplicate,
    async close() { await pool.end(); },
  };
  await ensureSchema(driver, 'mysql');
  logger?.info?.('scheduler queue mysql ready');
  return driver;
}
