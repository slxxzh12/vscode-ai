const DB_EXTS = ['.db', '.sqlite', '.sqlite3', '.db3'];

export function isDbExt(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return DB_EXTS.some((e) => n.endsWith(e));
}

export function shouldOpenInNavicat(name: string, sqlite: boolean): boolean {
  return isDbExt(name) || sqlite === true;
}

export function uniqueConnName(base: string, existing: string[]): string {
  const name = String(base || '').trim() || 'database';
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let i = 2; ; i += 1) {
    const cand = `${name} (${i})`;
    if (!taken.has(cand)) return cand;
  }
}
