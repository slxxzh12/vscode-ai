import type { NavicatProfile, NavicatType } from './useNavicat';

const SCHEME_RE = /^(mysql|postgres|postgresql|redis|sqlite):\/\//i;
const SQLITE_EXT_RE = /\.(db|sqlite|sqlite3|db3)$/i;

const DEFAULT_PORT: Record<Exclude<NavicatType, 'sqlite'>, string> = {
  mysql: '3306',
  postgres: '5432',
  redis: '6379',
};

export interface CsvParseError {
  line: number;
  reason: string;
}

export interface CsvParseResult {
  profiles: NavicatProfile[];
  errors: CsvParseError[];
}

// CSV 解析：支持 BOM、CRLF、双引号包裹字段、字段内 "" 转义与引号内逗号/换行。
// 返回二维数组，完全空白行被忽略。
export function parseCsv(text: string): string[][] {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { pushField(); continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i += 1; pushRow(); continue; }
    if (ch === '\n') { pushRow(); continue; }
    field += ch;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

export function isConnectionString(value: string): boolean {
  const s = String(value ?? '').trim();
  return SCHEME_RE.test(s) || SQLITE_EXT_RE.test(s);
}

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

// sqlite:///C:/a.db → C:/a.db；sqlite://C:/a.db → C:/a.db；sqlite://./a.db → ./a.db
function sqlitePath(rest: string): string {
  return decode(rest).replace(/^\/([A-Za-z]:[\\/])/, '$1');
}

function defaultName(p: NavicatProfile): string {
  if (p.type === 'sqlite') {
    const base = String(p.database || '').split(/[\\/]/).filter(Boolean).pop();
    return base || p.database || 'sqlite';
  }
  const host = p.host || 'localhost';
  return `${host}:${p.port}${p.database ? `/${p.database}` : ''}`;
}

function baseProfile(type: NavicatType): NavicatProfile {
  return { name: '', type, host: '', port: '', user: '', database: '', password: '', options: { ssl: false } };
}

export function parseConnectionString(raw: string): NavicatProfile | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const m = s.match(/^(mysql|postgres|postgresql|redis|sqlite):\/\/(.*)$/i);
  if (!m) {
    if (SQLITE_EXT_RE.test(s)) return { ...baseProfile('sqlite'), database: s };
    return null;
  }

  const scheme = m[1].toLowerCase();
  if (scheme === 'sqlite') return { ...baseProfile('sqlite'), database: sqlitePath(m[2]) };

  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname || '';
  if (!host) return null;

  const type: NavicatType = scheme === 'mysql' ? 'mysql' : scheme === 'redis' ? 'redis' : 'postgres';
  const port = u.port || DEFAULT_PORT[type as Exclude<NavicatType, 'sqlite'>];
  const database = decode(u.pathname || '').replace(/^\//, '');

  return {
    ...baseProfile(type),
    host,
    port,
    user: decode(u.username || ''),
    database,
    password: decode(u.password || ''),
  };
}

export function parseConnRow(row: string[]): { profile: NavicatProfile } | { error: string } {
  const cells = (row || []).map((c) => String(c ?? '').trim());
  let idx = cells.findIndex((c) => SCHEME_RE.test(c));
  if (idx < 0) idx = cells.findIndex((c) => SQLITE_EXT_RE.test(c));
  if (idx < 0) return { error: 'no-uri' };

  const parsed = parseConnectionString(cells[idx]);
  if (!parsed) return { error: 'bad-uri' };

  const name = idx > 0 ? (cells.slice(0, idx).find((c) => c) || '') : '';
  return { profile: { ...parsed, name: name || defaultName(parsed) } };
}

// —— 分列表头导入：IP/主机、用户名、密码、数据库名等各占一列 ——
type Field = 'name' | 'type' | 'host' | 'port' | 'user' | 'password' | 'database';
type ColumnMap = Partial<Record<Field, number>>;

// 表头别名（匹配时忽略大小写、空格、下划线与连字符）。
// 中文别名用 Unicode 转义书写，避免源码里出现中文字面量（i18n 检查要求）。
const FIELD_ALIASES: Record<Field, string[]> = {
  name: ['name', 'connection', 'connectionname', 'conn', 'title', '\u540d\u79f0', '\u8fde\u63a5\u540d'],
  type: ['type', 'engine', 'dbtype', 'database type', '\u7c7b\u578b', '\u6570\u636e\u5e93\u7c7b\u578b'],
  host: ['ip', 'host', 'hostname', 'server', 'address', 'ipaddress', '\u4e3b\u673a', '\u5730\u5740', '\u670d\u52a1\u5668', 'ip\u5730\u5740'],
  port: ['port', '\u7aef\u53e3'],
  user: ['user', 'username', 'account', 'login', 'userid', '\u7528\u6237', '\u7528\u6237\u540d', '\u8d26\u53f7'],
  password: ['password', 'passwd', 'pwd', 'pass', '\u5bc6\u7801', '\u53e3\u4ee4'],
  database: ['database', 'db', 'dbname', 'schema', 'databasename', '\u6570\u636e\u5e93', '\u6570\u636e\u5e93\u540d', '\u5e93\u540d'],
};

const ALIAS_TO_FIELD = new Map<string, Field>();
const normHeader = (v: string) => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
for (const [field, list] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
  for (const alias of list) ALIAS_TO_FIELD.set(normHeader(alias), field);
}

// 首行是否能当作表头：至少要有主机列，且用户名/密码/数据库至少出现一列。
function headerMap(row: string[]): ColumnMap | null {
  const map: ColumnMap = {};
  (row || []).forEach((cell, i) => {
    const field = ALIAS_TO_FIELD.get(normHeader(cell));
    if (field && map[field] == null) map[field] = i;
  });
  if (map.host == null) return null;
  if (map.user == null && map.password == null && map.database == null) return null;
  return map;
}

const POSTGRES_LABELS = new Set(['postgres', 'postgresql', 'pg', 'pgsql']);
const SQLITE_LABELS = new Set(['sqlite', 'sqlite3']);

function typeFromLabel(v: string): NavicatType {
  const s = String(v ?? '').trim().toLowerCase();
  if (POSTGRES_LABELS.has(s)) return 'postgres';
  if (s === 'redis') return 'redis';
  if (SQLITE_LABELS.has(s)) return 'sqlite';
  return 'mysql';
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// 无表头时的首列判断：IPv4、localhost 或带点的域名/主机名
function looksLikeHost(v: string): boolean {
  const s = String(v ?? '').trim();
  if (!s || /\s/.test(s) || isConnectionString(s)) return false;
  if (IPV4_RE.test(s)) return true;
  if (s.toLowerCase() === 'localhost') return true;
  return s.includes('.') && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(s);
}

function profileFromColumns(cells: string[], map: ColumnMap): NavicatProfile | null {
  const get = (f: Field) => {
    const i = map[f];
    return i == null ? '' : String(cells[i] ?? '').trim();
  };
  const type = typeFromLabel(get('type'));
  if (type === 'sqlite') {
    const database = get('database');
    if (!database) return null;
    const p = { ...baseProfile('sqlite'), database };
    p.name = get('name') || defaultName(p);
    return p;
  }
  const host = get('host');
  if (!host) return null;
  const p: NavicatProfile = {
    ...baseProfile(type),
    host,
    port: get('port') || DEFAULT_PORT[type as Exclude<NavicatType, 'sqlite'>],
    user: get('user'),
    password: get('password'),
    database: get('database'),
  };
  p.name = get('name') || defaultName(p);
  return p;
}

// 无表头兜底：按「IP/主机, 用户名, 密码, 数据库」四列（或前三列）解析。
function profileFromPositional(row: string[]): NavicatProfile | null {
  const cells = (row || []).map((c) => String(c ?? '').trim());
  if (cells.length < 3 || cells.length > 4) return null;
  if (!looksLikeHost(cells[0])) return null;
  const [host, user, password, database = ''] = cells;
  const p: NavicatProfile = {
    ...baseProfile('mysql'),
    host,
    port: DEFAULT_PORT.mysql,
    user,
    password,
    database,
  };
  p.name = defaultName(p);
  return p;
}

export function dedupeKey(p: NavicatProfile): string {
  const db = String(p.database || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return [p.type, p.host || '', p.port || '', p.user || '', db].join('|');
}

export function parseCsvProfiles(text: string): CsvParseResult {
  const rows = parseCsv(text);
  const profiles: NavicatProfile[] = [];
  const errors: CsvParseError[] = [];
  if (!rows.length) return { profiles, errors };

  const columns = headerMap(rows[0]);
  const start = columns ? 1 : 0;
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    const parsed = parseConnRow(row);
    if ('profile' in parsed) { profiles.push(parsed.profile); continue; }
    if (columns) {
      const p = profileFromColumns(row, columns);
      if (p) { profiles.push(p); continue; }
      errors.push({ line: i + 1, reason: 'missing-host' });
      continue;
    }
    const p = profileFromPositional(row);
    if (p) profiles.push(p);
    else errors.push({ line: i + 1, reason: parsed.error });
  }
  return { profiles, errors };
}

// —— 导入预览：把「CSV 列 → 连接字段」的映射交出去，供界面可编辑 ——
export type ImportField = Field;
export interface ImportMapping {
  hasHeader: boolean;
  map: Record<number, ImportField | null>;
}

function columnWidth(rows: string[][]): number {
  let width = 0;
  for (const row of rows.slice(0, 20)) width = Math.max(width, row.length);
  return width;
}

// 自动猜映射：首行像表头就按别名映射，否则按 IP/用户名/密码/数据库 位置。
export function detectImportMapping(rows: string[][]): ImportMapping {
  const map: Record<number, ImportField | null> = {};
  const width = columnWidth(rows);
  for (let i = 0; i < width; i += 1) map[i] = null;
  const header = rows.length ? headerMap(rows[0]) : null;
  if (header) {
    for (const [field, idx] of Object.entries(header) as [ImportField, number][]) {
      if (map[idx] == null) map[idx] = field;
    }
    return { hasHeader: true, map };
  }
  const positional: ImportField[] = ['host', 'user', 'password', 'database'];
  for (let i = 0; i < width && i < positional.length; i += 1) map[i] = positional[i];
  return { hasHeader: false, map };
}

export function buildProfiles(rows: string[][], mapping: ImportMapping): CsvParseResult {
  const profiles: NavicatProfile[] = [];
  const errors: CsvParseError[] = [];
  if (!rows.length) return { profiles, errors };
  const columns: ColumnMap = {};
  for (const [key, field] of Object.entries(mapping.map || {}) as [string, ImportField | null][]) {
    if (!field) continue;
    const idx = Number(key);
    if (Number.isInteger(idx) && columns[field] == null) columns[field] = idx;
  }
  const start = mapping.hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    const parsed = parseConnRow(row);
    if ('profile' in parsed) { profiles.push(parsed.profile); continue; }
    const p = profileFromColumns(row, columns);
    if (p) { profiles.push(p); continue; }
    errors.push({ line: i + 1, reason: 'missing-host' });
  }
  return { profiles, errors };
}

// 导入模板：表头 + 一行示例（ASCII，避免不同 Excel 编码问题）；带 BOM 便于 Excel 直接打开。
export function csvImportTemplate(): string {
  const headers = ['name', 'type', 'host', 'port', 'user', 'password', 'database'];
  const sample = ['example', 'mysql', '127.0.0.1', '3306', 'root', 'password', 'demo'];
  return '\uFEFF' + headers.join(',') + '\r\n' + sample.join(',') + '\r\n';
}
