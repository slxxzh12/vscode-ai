import { describe, it, expect } from 'vitest';
import { dedupeKey, parseConnRow, parseConnectionString, parseCsv, parseCsvProfiles } from './csvImport';

describe('parseCsv', () => {
  it('处理 BOM、CRLF、引号内逗号与 "" 转义', () => {
    const text = '\uFEFF名称,连接串\r\n"a, b",mysql://u:p@h:3306/d\r\n"say ""hi""",redis://h';
    expect(parseCsv(text)).toEqual([
      ['名称', '连接串'],
      ['a, b', 'mysql://u:p@h:3306/d'],
      ['say "hi"', 'redis://h'],
    ]);
  });

  it('忽略完全空白行，支持引号内换行', () => {
    const text = 'mysql://h1\n\n  \n"x\ny",mysql://h2/db';
    expect(parseCsv(text)).toEqual([
      ['mysql://h1'],
      ['x\ny', 'mysql://h2/db'],
    ]);
  });
});

describe('parseConnectionString', () => {
  it('mysql：解析用户/密码/主机/端口/库', () => {
    const p = parseConnectionString('mysql://root:p%40ss@127.0.0.1:3307/mydb');
    expect(p).toMatchObject({ type: 'mysql', user: 'root', password: 'p@ss', host: '127.0.0.1', port: '3307', database: 'mydb' });
  });

  it('mysql：缺端口用默认 3306', () => {
    expect(parseConnectionString('mysql://u@h/db')).toMatchObject({ port: '3306', type: 'mysql' });
  });

  it('postgres 与 postgresql 归为 postgres，默认 5432', () => {
    expect(parseConnectionString('postgres://u@h/db')).toMatchObject({ type: 'postgres', port: '5432' });
    expect(parseConnectionString('postgresql://u@h/db')).toMatchObject({ type: 'postgres', port: '5432' });
  });

  it('redis：库索引作为 database，默认 6379', () => {
    expect(parseConnectionString('redis://:pw@h/2')).toMatchObject({ type: 'redis', password: 'pw', database: '2', port: '6379' });
  });

  it('sqlite：sqlite:// 与裸路径', () => {
    expect(parseConnectionString('sqlite:///C:/data/a.db')).toMatchObject({ type: 'sqlite', database: 'C:/data/a.db' });
    expect(parseConnectionString('C:\\data\\b.sqlite')).toMatchObject({ type: 'sqlite', database: 'C:\\data\\b.sqlite' });
  });

  it('非法值返回 null', () => {
    expect(parseConnectionString('not-a-uri')).toBeNull();
    expect(parseConnectionString('mysql://')).toBeNull();
  });
});

describe('parseConnRow', () => {
  it('名称列 + 连接串', () => {
    expect(parseConnRow(['业务库', 'mysql://u@h/db'])).toMatchObject({ profile: { name: '业务库', type: 'mysql' } });
  });

  it('单列连接串：名称按 host:port/db 生成', () => {
    expect(parseConnRow(['mysql://u@h:3306/db'])).toMatchObject({ profile: { name: 'h:3306/db' } });
  });

  it('名称以 .db 结尾时仍优先识别带协议的连接串列', () => {
    expect(parseConnRow(['备份.db', 'mysql://u@h/db'])).toMatchObject({ profile: { name: '备份.db', type: 'mysql' } });
  });

  it('SQLite 名称按文件名生成', () => {
    expect(parseConnRow(['sqlite:///C:/data/app.db'])).toMatchObject({ profile: { name: 'app.db', type: 'sqlite' } });
  });

  it('无连接串返回错误', () => {
    expect(parseConnRow(['just', 'text'])).toEqual({ error: 'no-uri' });
  });
});

describe('dedupeKey', () => {
  it('忽略路径分隔符与末尾斜杠差异', () => {
    const a = { name: 'a', type: 'sqlite' as const, host: '', port: '', user: '', database: 'C:\\d\\a.db' };
    const b = { name: 'b', type: 'sqlite' as const, host: '', port: '', user: '', database: 'C:/d/a.db' };
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });
});

describe('parseCsvProfiles', () => {
  it('收集有效行并记录错误行号', () => {
    const text = 'mysql://u@h/db\nbad line\nredis://h';
    const r = parseCsvProfiles(text);
    expect(r.profiles.map((p) => p.type)).toEqual(['mysql', 'redis']);
    expect(r.errors).toEqual([{ line: 2, reason: 'no-uri' }]);
  });
});
