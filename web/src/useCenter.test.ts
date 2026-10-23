import { test, expect } from 'vitest';
import { useCenter } from './useCenter';
import { useLocalSources } from './local/useLocalSources';

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

test('openTool 新增并激活工具页签；重复打开只激活', () => {
  const c = useCenter();
  c.openTool('notepad');
  expect(c.tabs.value).toHaveLength(1);
  expect(c.tabs.value[0]).toMatchObject({ id: 't:notepad', kind: 'tool', tool: 'notepad' });
  expect(c.activeId.value).toBe('t:notepad');
  c.openTool('notepad');
  expect(c.tabs.value).toHaveLength(1);
});

test('openTool 可同时打开多个工具页签', () => {
  const c = useCenter();
  c.openTool('notepad');
  c.openTool('yaml');
  expect(c.tabs.value.map((t) => t.id)).toEqual(['t:notepad', 't:yaml']);
  expect(c.activeId.value).toBe('t:yaml');
});

test('closeById 关闭工具页签', () => {
  const c = useCenter();
  c.openTool('yaml');
  c.closeById('t:yaml');
  expect(c.tabs.value).toHaveLength(0);
  expect(c.activeId.value).toBeNull();
});

test('closeById 关闭激活的工具页签回退到会话页签', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.openTool('notepad');
  c.closeById('t:notepad');
  expect(c.activeId.value).toBe('s:a');
});

test('openLocalRoot 新增并激活；重复打开只更新 label', () => {
  const c = useCenter();
  c.openLocalRoot('proj-a');
  expect(c.tabs.value[0]).toMatchObject({ id: 'l:root', kind: 'local', label: 'proj-a' });
  expect(c.activeId.value).toBe('l:root');
  c.openLocalRoot('proj-b');
  expect(c.tabs.value).toHaveLength(1);
  expect(c.tabs.value[0].label).toBe('proj-b');
});

test('openLocalFile 新增并激活；closeById 关闭时清状态', () => {
  const c = useCenter();
  const s = useLocalSources();
  s.clearAll();
  s.mountFolder({ kind: 'directory', name: 'proj' } as unknown as FileSystemDirectoryHandle);
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: null }]);
  c.openLocalFile(keys[0], 'f.txt');
  expect(c.activeId.value).toBe(`l:f:${keys[0]}`);
  c.closeById(`l:f:${keys[0]}`);
  expect(s.files.value.size).toBe(0);
  expect(c.tabs.value).toHaveLength(0);
});

test('closeById 关闭本地根页签卸载根且不影响单文件页签', () => {
  const c = useCenter();
  const s = useLocalSources();
  s.clearAll();
  s.mountFolder({ kind: 'directory', name: 'proj' } as unknown as FileSystemDirectoryHandle);
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: null }]);
  c.openLocalFile(keys[0], 'f.txt');
  c.openLocalRoot('proj');
  c.closeById('l:root');
  expect(s.root.value).toBeNull();
  expect(s.files.value.size).toBe(1);
  expect(c.tabs.value.some((t) => t.id === `l:f:${keys[0]}`)).toBe(true);
});

test('visibleTabs 按 scopeProjectId 过滤会话页签，文件/工具始终可见', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', 'p1');
  c.ensureSession('b', 'B', 'running', 'p2');
  c.openFile('p1', 'x.ts', 'x.ts');
  c.openTool('notepad');
  c.scopeProjectId.value = 'p1';
  expect(c.visibleTabs.value.map((t) => t.id)).toEqual(['s:a', 'f:p1|x.ts', 't:notepad']);
  c.scopeProjectId.value = 'p2';
  expect(c.visibleTabs.value.map((t) => t.id)).toEqual(['s:b', 'f:p1|x.ts', 't:notepad']);
});

test('visibleTabs：null 与空串视为同作用域', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', '');
  c.scopeProjectId.value = null;
  expect(c.visibleTabs.value.some((t) => t.id === 's:a')).toBe(true);
});

test('关闭活动文件页签兜底不落到隐藏会话页签', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running', 'p1');
  c.ensureSession('b', 'B', 'running', 'p2');
  c.scopeProjectId.value = 'p1';
  c.activateSession('a', 'p1');
  c.openFile('p1', 'x.ts', 'x.ts');
  c.closeById('f:p1|x.ts');
  expect(c.activeId.value).toBe('s:a');
});

test('openScheduler 打开唯一调度页签并激活，closeById 可关闭', () => {
  const c = useCenter();
  c.ensureSession('a', 'A', 'running');
  c.activateSession('a');
  c.openScheduler('任务');
  expect(c.activeKind.value).toBe('scheduler');
  expect(c.tabs.value.filter((t) => t.kind === 'scheduler')).toHaveLength(1);
  c.openScheduler('任务2');
  expect(c.tabs.value.filter((t) => t.kind === 'scheduler')).toHaveLength(1);
  expect(c.tabs.value.find((t) => t.kind === 'scheduler')?.label).toBe('任务2');
  c.closeById('x:scheduler');
  expect(c.activeId.value).toBe('s:a');
});
