import { test, expect } from 'vitest';
import { useCenter } from './useCenter';

test('重命名后反复切换会话，页签名不回退', () => {
  const c = useCenter();
  c.ensureSession('a', '我的会话', 'running');
  c.ensureSession('b', '会话 B', 'running');
  c.activateSession('a');
  c.activateSession('b');
  c.activateSession('a');
  expect(c.tabs.value.find((t) => t.id === 's:a')?.label).toBe('我的会话');
});

test('activateSession 对已存在会话保留 label 与 state', () => {
  const c = useCenter();
  c.ensureSession('a', '自定义', 'exited');
  c.activateSession('a');
  expect(c.tabs.value.find((t) => t.id === 's:a')).toMatchObject({ label: '自定义', sub: 'exited' });
  expect(c.activeId.value).toBe('s:a');
});

test('activateSession 对不存在的会话兜底创建页签并激活', () => {
  const c = useCenter();
  c.activateSession('z');
  expect(c.tabs.value.find((t) => t.id === 's:z')).toMatchObject({ kind: 'session', id: 's:z' });
  expect(c.activeId.value).toBe('s:z');
});

test('hasSession 只对已打开的会话页签返回 true', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.openFile('p', 'x.ts', 'x.ts');
  expect(c.hasSession('a')).toBe(true);
  expect(c.hasSession('b')).toBe(false);
});

test('ensureSession 已存在时只更新 label/sub', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.ensureSession('a', 'A2', 'exited');
  expect(c.tabs.value.filter((t) => t.id === 's:a')).toHaveLength(1);
  expect(c.tabs.value[0]).toMatchObject({ label: 'A2', sub: 'exited' });
});

test('openFile 新开并激活文件页签；closeFile 回退到会话页签', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.activateSession('a');
  c.openFile('p', 'src/x.ts', 'x.ts');
  expect(c.activeId.value).toBe('f:p|src/x.ts');
  expect(c.activeKind.value).toBe('file');
  c.closeFile('p', 'src/x.ts');
  expect(c.tabs.value.some((t) => t.id === 'f:p|src/x.ts')).toBe(false);
  expect(c.activeId.value).toBe('s:a');
});

test('openFile 已存在只更新 label，不新增页签', () => {
  const c = useCenter();
  c.openFile('p', 'a.ts', 'a.ts');
  c.openFile('p', 'a.ts', 'a2.ts');
  expect(c.tabs.value).toHaveLength(1);
  expect(c.tabs.value[0].label).toBe('a2.ts');
});

test('removeSession 删除页签，激活中则回退到剩余会话', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.ensureSession('b', 'B', 'running');
  c.activateSession('b');
  c.removeSession('b');
  expect(c.tabs.value.some((t) => t.id === 's:b')).toBe(false);
  expect(c.activeId.value).toBe('s:a');
});

test('removeSession 删除非激活页签不影响 activeId', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.ensureSession('b', 'B', 'running');
  c.activateSession('a');
  c.removeSession('b');
  expect(c.activeId.value).toBe('s:a');
});

test('closeById 文件页签走 closeFile，会话页签直接删并在激活时回退', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.activateSession('a');
  c.openFile('p', 'x.ts', 'x.ts');
  c.closeById('f:p|x.ts');
  expect(c.tabs.value.some((t) => t.id === 'f:p|x.ts')).toBe(false);
  expect(c.activeId.value).toBe('s:a');

  c.closeById('s:a');
  expect(c.tabs.value).toHaveLength(0);
  expect(c.activeId.value).toBeNull();
});

test('closeFile 回退到其他页签（无会话时取首个页签）', () => {
  const c = useCenter();
  c.openFile('p', 'a.ts', 'a.ts');
  c.openFile('p', 'b.ts', 'b.ts');
  c.closeFile('p', 'b.ts');
  expect(c.activeId.value).toBe('f:p|a.ts');
});

test('setActive 忽略未注册 id；activateFileTab 直接激活', () => {
  const c = useCenter();
  c.openFile('p', 'a.ts', 'a.ts');
  c.setActive('f:p|missing.ts');
  expect(c.activeId.value).toBe('f:p|a.ts');
  c.setActive(null);
  expect(c.activeId.value).toBeNull();
  c.activateFileTab('f:p|a.ts');
  expect(c.activeId.value).toBe('f:p|a.ts');
});

test('默认 activeKind 为 session', () => {
  const c = useCenter();
  expect(c.activeKind.value).toBe('session');
  expect(c.active.value).toBeNull();
});
