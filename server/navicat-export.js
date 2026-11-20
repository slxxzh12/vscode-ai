// 批量导出数据库内容：结构（DDL）+ 每表按 ID 首尾各 N 条抽样数据，输出 SQL / CSV。
// 与驱动解耦：所有查询经注入的 exec（createNavicatExec 的实例）执行，便于测试。

const BOM = '\uFEFF';
const SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const PG_SYSTEM_DBS = new Set(['postgres', 'template0', 'template1']);

export function quoteIdent(type, name) {
  const s = String(name ?? '');
  if (type === 'mysql') return '`' + s.split('`').join('``') + '`';
  return '"' + s.split('"').join('""') + '"';
}

function strLit(type, value) {
  let s = String(value ?? '');
  if (type === 'mysql') {
    s = s.replace(/\\/g, '\\\\').replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\x1a/g, '\\Z');
  }
  return "'" + s.split("'").join("''") + "'";
}

function pgRegclass(table) {
  const ident = '"' + String(table).split('"').join('""') + '"';
  return "'" + `public.${ident}`.replace(/\\/g, '\\\\').split("'").join("''") + "'";
}

export function sqlValue(type, v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return strLit(type, v.toISOString());
  if (Buffer.isBuffer(v)) {
    const hex = v.toString('hex');
    return type === 'postgres' ? `'\\x${hex}'::bytea` : `X'${hex}'`;
  }
  if (typeof v === 'object') return strLit(type, JSON.stringify(v));
  return strLit(type, v);
}

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvField(v) {
  const s = csvCell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells) {
  return (cells || []).map(csvField).join(',');
}

export function safeName(name) {
  const s = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  return (s || 'unnamed').slice(0, 120);
}

export function pickIdColumn(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const pk = list.filter((c) => c.pk);
  if (pk.length === 1) return String(pk[0].name);
  const byId = list.find((c) => String(c.name).toLowerCase() === 'id');
  if (byId) return String(byId.name);
  return list.length ? String(list[0].name) : '';
}

// 抽样排序键：优先用全部主键列（支持联合主键），其次 id，再退第一列。
export function pickIdColumns(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const pk = list.filter((c) => c.pk).map((c) => String(c.name));
  if (pk.length) return pk;
  const byId = list.find((c) => String(c.name).toLowerCase() === 'id');
  if (byId) return [String(byId.name)];
  return list.length ? [String(list[0].name)] : [];
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

async function tableMeta(exec, profile, password, db, table) {
  const type = profile.type;
  const p = { ...profile, database: type === 'sqlite' ? profile.database : db };

  if (type === 'mysql') {
    const cols = await exec.exec(p, password,
      `SELECT column_name, column_type, is_nullable, column_default, column_key, ordinal_position ` +
      `FROM information_schema.columns WHERE table_schema = ${strLit(type, db)} AND table_name = ${strLit(type, table)} ` +
      'ORDER BY ordinal_position', { maxRows: 100000 });
    const ddlRes = await exec.exec(p, password, `SHOW CREATE TABLE ${quoteIdent(type, db)}.${quoteIdent(type, table)}`, { maxRows: 10 });
    return {
      ddl: String(ddlRes.rows?.[0]?.[1] || ''),
      columns: (cols.rows || []).map((r) => ({ name: r[0], type: r[1], nullable: r[2] === 'YES', def: r[3], pk: r[4] === 'PRI' })),
    };
  }

  if (type === 'postgres') {
    const reg = pgRegclass(table);
    const cols = await exec.exec(p, password,
      'SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull, ' +
      'pg_get_expr(ad.adbin, ad.adrelid) AS def FROM pg_attribute a ' +
      'LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum ' +
      `WHERE a.attrelid = ${reg}::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, { maxRows: 100000 });
    const pkRes = await exec.exec(p, password,
      'SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
      `WHERE i.indrelid = ${reg}::regclass AND i.indisprimary ORDER BY a.attnum`, { maxRows: 1000 });
    const pkNames = (pkRes.rows || []).map((r) => String(r[0]));
    const pkSet = new Set(pkNames);
    const columns = (cols.rows || []).map((r) => ({ name: r[0], type: r[1], nullable: !r[2], def: r[3], pk: pkSet.has(String(r[0])) }));
    const lines = columns.map((c) => `  ${quoteIdent(type, c.name)} ${c.type}${c.def ? ` DEFAULT ${c.def}` : ''}${c.nullable ? '' : ' NOT NULL'}`);
    if (pkNames.length) lines.push(`  PRIMARY KEY (${pkNames.map((n) => quoteIdent(type, n)).join(', ')})`);
    const ddl = `CREATE TABLE ${quoteIdent(type, 'public')}.${quoteIdent(type, table)} (\n${lines.join(',\n')}\n);`;
    return { ddl, columns };
  }

  const info = await exec.exec(p, password, `PRAGMA table_info(${quoteIdent(type, table)})`, { maxRows: 100000 });
  const columns = (info.rows || []).map((r) => ({ name: r[1], type: r[2], nullable: !r[3], def: r[4], pk: Number(r[5]) > 0 }));
  const ddlRes = await exec.exec(p, password,
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${strLit(type, table)}`, { maxRows: 10 });
  return { ddl: String(ddlRes.rows?.[0]?.[0] || ''), columns };
}

async function sampleTable(exec, profile, password, db, table, idCols, n, sample = true) {
  const type = profile.type;
  const p = { ...profile, database: type === 'sqlite' ? profile.database : db };
  const t = quoteIdent(type, table);
  if (sample === false) {
    // 不抽样：导出整表（受驱动上限保护，仍会一次性读入内存）。
    const all = await exec.exec(p, password, `SELECT * FROM ${t}`, { maxRows: Number.MAX_SAFE_INTEGER });
    return { columns: Array.isArray(all.columns) ? all.columns : [], rows: all.rows || [] };
  }
  const keys = Array.isArray(idCols) ? idCols.filter(Boolean) : [];
  const order = keys.length ? ` ORDER BY ${keys.map((c) => quoteIdent(type, c)).join(', ')}` : '';
  const head = await exec.exec(p, password, `SELECT * FROM ${t}${order} LIMIT ${n}`, { maxRows: n });
  const columns = Array.isArray(head.columns) ? head.columns : [];
  const rows = (head.rows || []).slice();
  if (!keys.length) return { columns, rows };

  // 按主键取「最小 n 条 + 最大 n 条」；联合主键用整组键去重。
  const tail = await exec.exec(p, password, `SELECT * FROM ${t}${order} DESC LIMIT ${n}`, { maxRows: n });
  const idxs = keys.map((c) => columns.indexOf(c));
  const keyOf = (r) => (idxs.every((i) => i >= 0) ? JSON.stringify(idxs.map((i) => r[i])) : JSON.stringify(r));
  const seen = new Set(rows.map(keyOf));
  for (const r of (tail.rows || []).slice().reverse()) {
    const key = keyOf(r);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  return { columns, rows };
}

function dataCsv(sample) {
  if (!sample.columns.length) return BOM;
  const lines = [csvRow(sample.columns)];
  for (const r of sample.rows) lines.push(csvRow(r));
  return BOM + lines.join('\r\n') + '\r\n';
}

function buildInserts(type, table, sample) {
  if (!sample.columns.length) return `-- ${table}: no columns`;
  if (!sample.rows.length) return `-- ${table}: no data`;
  const cols = sample.columns.map((c) => quoteIdent(type, c)).join(', ');
  const target = quoteIdent(type, table);
  const lines = sample.rows.map((r) => `INSERT INTO ${target} (${cols}) VALUES (${r.map((v) => sqlValue(type, v)).join(', ')});`);
  return `-- ${table}\n${lines.join('\n')}`;
}

async function exportConnection(exec, profile, password, { n, formats, sample = true, onProgress, shouldStop, counter }, errors) {
  const type = profile.type;
  if (type === 'redis') {
    errors.push(`${profile.name}: redis connections are not exported`);
    return [];
  }

  const files = [];
  const connDir = safeName(profile.name || profile.id || type);
  let dbs;
  if (type === 'sqlite') {
    dbs = [{ name: baseName(profile.database) || 'sqlite', database: profile.database }];
  } else if (type === 'mysql') {
    if (profile.database) {
      dbs = [{ name: profile.database, database: profile.database }];
    } else {
      let all = [];
      try { all = await exec.listDatabases(profile, password); }
      catch (e) { errors.push(`${profile.name}: list databases failed: ${e.message}`); return files; }
      dbs = all.filter((d) => !SYSTEM_DBS.has(d)).map((d) => ({ name: d, database: d }));
    }
  } else {
    // PostgreSQL：指定了库只导该库；未指定则导出全部业务库。
    if (profile.database) {
      dbs = [{ name: profile.database, database: profile.database }];
    } else {
      let all = [];
      try { all = await exec.listDatabases(profile, password); }
      catch (e) { errors.push(`${profile.name}: list databases failed: ${e.message}`); return files; }
      dbs = all.filter((d) => !PG_SYSTEM_DBS.has(d)).map((d) => ({ name: d, database: d }));
    }
  }

  let dbIndex = 0;
  for (const db of dbs) {
    if (shouldStop?.()) throw new Error('cancelled');
    dbIndex += 1;
    counter.dbsDone += 1;
    const dbDir = `${connDir}/${safeName(db.name)}`;
    onProgress?.({ connection: profile.name || profile.id || '', db: db.name, dbIndex, dbTotal: dbs.length, tablesDone: counter.tablesDone, phase: 'db' });
    let tables = [];
    try {
      const listProfile = type === 'sqlite' ? profile : { ...profile, database: db.database };
      tables = await exec.listTables(listProfile, password, db.database);
    } catch (e) {
      errors.push(`${profile.name}/${db.name}: list tables failed: ${e.message}`);
      continue;
    }

    const schemaParts = [`-- ${profile.name} / ${db.name}`, ''];
    const dataParts = [`-- ${profile.name} / ${db.name}`, ''];
    for (let ti = 0; ti < tables.length; ti += 1) {
      const table = tables[ti];
      if (shouldStop?.()) throw new Error('cancelled');
      counter.tablesDone += 1;
      onProgress?.({ connection: profile.name || profile.id || '', db: db.name, dbIndex, dbTotal: dbs.length, table, tableIndex: ti + 1, tableTotal: tables.length, tablesDone: counter.tablesDone, phase: 'table' });
      try {
        const meta = await tableMeta(exec, profile, password, db.database, table);
        const idCols = pickIdColumns(meta.columns);
        const sampled = await sampleTable(exec, profile, password, db.database, table, idCols, n, sample);
        if (formats.includes('sql')) {
          schemaParts.push(meta.ddl || `-- ${table}: DDL unavailable`, '');
          dataParts.push(buildInserts(type, table, sampled), '');
        }
        if (formats.includes('csv')) {
          files.push({ path: `${dbDir}/csv/${safeName(table)}.data.csv`, data: dataCsv(sampled) });
        }
      } catch (e) {
        errors.push(`${profile.name}/${db.name}/${table}: ${e.message}`);
      }
    }

    if (formats.includes('sql')) {
      files.push({ path: `${dbDir}/schema.sql`, data: BOM + schemaParts.join('\n') });
      files.push({ path: `${dbDir}/data.sql`, data: BOM + dataParts.join('\n') });
    }
  }

  return files;
}

export function createNavicatExport({ exec }) {
  return {
    async build({ items, n = 30, formats = ['sql', 'csv'], sample = true, onProgress = null, shouldStop = null }) {
      const limit = Math.min(Math.max(Number(n) || 30, 1), 1000);
      const fmts = (Array.isArray(formats) ? formats : []).filter((f) => f === 'sql' || f === 'csv');
      const use = fmts.length ? fmts : ['sql', 'csv'];
      const files = [];
      const errors = [];
      const counter = { dbsDone: 0, tablesDone: 0 };
      for (const item of items || []) {
        try {
          files.push(...(await exportConnection(exec, item.profile, item.password, { n: limit, formats: use, sample, onProgress, shouldStop, counter }, errors)));
        } catch (e) {
          errors.push(`${item.profile?.name || item.profile?.id || '?'}: ${e.message}`);
        }
      }
      return { files, errors };
    },
  };
}
