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
