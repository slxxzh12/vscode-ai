import { describe, it, expect } from 'vitest';
import { buildProfiles, csvImportTemplate, dedupeKey, detectImportMapping, parseConnRow, parseConnectionString, parseCsv, parseCsvProfiles } from './csvImport';

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

  it('表头分列：IP/用户名/密码/数据库（中文表头）', () => {
    const text = 'IP,用户名,密码,数据库\n127.0.0.1,root,secret,demo\n10.0.0.2,sa,pw,app';
    const r = parseCsvProfiles(text);
    expect(r.errors).toEqual([]);
    expect(r.profiles[0]).toMatchObject({ type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', password: 'secret', database: 'demo' });
    expect(r.profiles[1]).toMatchObject({ host: '10.0.0.2', user: 'sa', password: 'pw', database: 'app' });
  });

  it('表头分列：name/type/host/port/user/password/database', () => {
    const text = 'name,type,host,port,user,password,database\npg库,postgres,db.internal,5433,u,p,main';
    const r = parseCsvProfiles(text);
    expect(r.errors).toEqual([]);
    expect(r.profiles[0]).toMatchObject({ name: 'pg库', type: 'postgres', host: 'db.internal', port: '5433', user: 'u', password: 'p', database: 'main' });
  });

  it('无表头四列按 IP/用户名/密码/数据库 解析', () => {
    const r = parseCsvProfiles('192.168.1.5,admin,pw,demo');
    expect(r.errors).toEqual([]);
    expect(r.profiles[0]).toMatchObject({ type: 'mysql', host: '192.168.1.5', port: '3306', user: 'admin', password: 'pw', database: 'demo' });
  });

  it('表头下的连接串行仍优先按 URI 解析', () => {
    const r = parseCsvProfiles('IP,用户名,密码,数据库\nmysql://u:p@h:3307/d');
    expect(r.errors).toEqual([]);
    expect(r.profiles[0]).toMatchObject({ type: 'mysql', host: 'h', port: '3307', database: 'd', user: 'u', password: 'p' });
  });
});

describe('detectImportMapping / buildProfiles', () => {
  it('中文表头自动映射并生成连接', () => {
    const rows = [['IP', '用户名', '密码', '数据库'], ['127.0.0.1', 'root', 'pw', 'demo']];
    const m = detectImportMapping(rows);
    expect(m.hasHeader).toBe(true);
    expect(m.map).toMatchObject({ 0: 'host', 1: 'user', 2: 'password', 3: 'database' });
    const r = buildProfiles(rows, m);
    expect(r.profiles[0]).toMatchObject({ host: '127.0.0.1', user: 'root', password: 'pw', database: 'demo', type: 'mysql', port: '3306' });
  });

  it('用户改映射后按新列批量生成', () => {
    const rows = [['pw', 'demo', '127.0.0.1', 'root']];
    const m = detectImportMapping(rows);
    expect(m.hasHeader).toBe(false);
    m.map = { 0: 'password', 1: 'database', 2: 'host', 3: 'user' };
    const r = buildProfiles(rows, m);
    expect(r.profiles[0]).toMatchObject({ host: '127.0.0.1', user: 'root', password: 'pw', database: 'demo' });
  });

  it('未映射主机列时不生成连接', () => {
    const rows = [['IP', '用户名'], ['127.0.0.1', 'root']];
    const r = buildProfiles(rows, { hasHeader: true, map: { 0: null, 1: 'user' } });
    expect(r.profiles).toHaveLength(0);
    expect(r.errors[0].reason).toBe('missing-host');
  });
});

describe('csvImportTemplate', () => {
  it('模板带表头和示例行，可直接解析为一条连接', () => {
    const text = csvImportTemplate();
    expect(text.charCodeAt(0)).toBe(0xFEFF);
    const r = parseCsvProfiles(text);
    expect(r.errors).toEqual([]);
    expect(r.profiles[0]).toMatchObject({
      name: 'example', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', password: 'password', database: 'demo',
    });
  });
});
