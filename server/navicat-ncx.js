import crypto from 'node:crypto';

// Navicat 导出文件里的密码算法（与 Navicat 11 系一致）：
// AES-128-CBC，key/IV 固定，输出大写 hex
const NAV_KEY = Buffer.from('libcckeylibcckey', 'latin1');
const NAV_IV = Buffer.from('libcciv libcciv ', 'latin1');

// ConnType 取值 Navicat 未公开，集中在此便于按实测校准
export const NAVICAT_CONN_TYPE = { mysql: 0, postgres: 1, sqlite: 3, redis: 7 };

export function navicatEncrypt(plain) {
  const c = crypto.createCipheriv('aes-128-cbc', NAV_KEY, NAV_IV);
  const ct = Buffer.concat([c.update(Buffer.from(String(plain ?? ''), 'utf8')), c.final()]);
  return ct.toString('hex').toUpperCase();
}

export function navicatDecrypt(hex) {
  const bin = Buffer.from(String(hex ?? '').trim(), 'hex');
  const d = crypto.createDecipheriv('aes-128-cbc', NAV_KEY, NAV_IV);
  return Buffer.concat([d.update(bin), d.final()]).toString('utf8');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildNcx(entries) {
  const rows = (entries || []).map((e) => {
    const attrs = [
      ['ConnectionName', e.name],
      ['ConnType', NAVICAT_CONN_TYPE[e.type] ?? ''],
      ['Host', e.host ?? ''],
      ['Port', e.port ?? ''],
      ['Database', e.database ?? ''],
      ['UserName', e.user ?? ''],
      ['Password', navicatEncrypt(e.password || '')],
    ];
    return `  <Connection ${attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`;
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<Connections>', ...rows, '</Connections>', ''].join('\n');
}

export function connectionString(profile, password, { withPassword = false } = {}) {
  if (profile.type === 'sqlite') return String(profile.database || '');
  const user = encodeURIComponent(profile.user || '');
  const pw = withPassword ? encodeURIComponent(password || '') : '';
  let auth = '';
  if (user) auth = withPassword ? `${user}:${pw}@` : `${user}@`;
  else if (withPassword && password) auth = `:${pw}@`;
  const host = profile.host || '';
  if (profile.type === 'mysql') return `mysql://${auth}${host}:${profile.port || 3306}/${encodeURIComponent(profile.database || '')}`;
  if (profile.type === 'postgres') return `postgresql://${auth}${host}:${profile.port || 5432}/${encodeURIComponent(profile.database || '')}`;
  if (profile.type === 'redis') return `redis://${auth}${host}:${profile.port || 6379}/${profile.database || 0}`;
  return '';
}
