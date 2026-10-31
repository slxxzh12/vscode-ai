import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureSchema } from './schema.js';

export async function createSqliteDriver({ file }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  let chain = Promise.resolve();

  function enqueue(fn) {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  }
  function rawQuery(sql, params = []) { return db.prepare(sql).all(...params); }
  function rawRun(sql, params = []) {
    const r = db.prepare(sql).run(...params);
    return { changes: Number(r.changes || 0), insertId: Number(r.lastInsertRowid || 0) };
  }

  const driver = {
    dialect: 'sqlite',
    exec(sql) { return enqueue(() => { db.exec(sql); }); },
    query(sql, params = []) { return enqueue(() => rawQuery(sql, params)); },
    run(sql, params = []) { return enqueue(() => rawRun(sql, params)); },
    transaction(fn) {
      return enqueue(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn({
            query(sql, params = []) { return rawQuery(sql, params); },
            run(sql, params = []) { return rawRun(sql, params); },
          });
          db.exec('COMMIT');
          return out;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      });
    },
    isDuplicate(e) { return /UNIQUE constraint failed/i.test(String(e && e.message || e)); },
    async close() { await chain; db.close(); },
  };
  await ensureSchema(driver, 'sqlite');
  return driver;
}
