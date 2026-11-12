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

export function dedupeKey(p: NavicatProfile): string {
  const db = String(p.database || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return [p.type, p.host || '', p.port || '', p.user || '', db].join('|');
}

export function parseCsvProfiles(text: string): CsvParseResult {
  const rows = parseCsv(text);
  const profiles: NavicatProfile[] = [];
  const errors: CsvParseError[] = [];
  rows.forEach((row, i) => {
    const r = parseConnRow(row);
    if ('error' in r) errors.push({ line: i + 1, reason: r.error });
    else profiles.push(r.profile);
  });
  return { profiles, errors };
}
