import { describe, it, expect } from 'vitest';
import { parseOpenParam, parseVoidProject } from './deeplink';

describe('parseOpenParam', () => {
  it('解析并解码 open 参数', () => {
    expect(parseOpenParam('?open=C%3A%5Ctmp%5Ca.md')).toBe('C:\\tmp\\a.md');
  });
  it('无 open 返回 null', () => {
    expect(parseOpenParam('')).toBeNull();
    expect(parseOpenParam('?x=1')).toBeNull();
  });
  it('允许省略问号', () => {
    expect(parseOpenParam('open=%2Fhome%2Fb.yaml')).toBe('/home/b.yaml');
  });
});

describe('parseVoidProject', () => {
  it('解析并解码 voidProject 参数', () => {
    expect(parseVoidProject('?voidProject=demo')).toBe('demo');
    expect(parseVoidProject('?voidProject=a%20b')).toBe('a b');
  });
  it('无 voidProject 返回 null', () => {
    expect(parseVoidProject('')).toBeNull();
    expect(parseVoidProject('?open=x')).toBeNull();
  });
});
