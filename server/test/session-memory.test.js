import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWinProcessTable, parsePsProcessTable, sumSessionMemory,
  collectProcessTable, collectSessionMemory, clearSessionMemoryCache,
} from '../session-memory.js';

test('session memory：解析 Windows / POSIX 进程表', () => {
  assert.deepEqual(parseWinProcessTable('100 1 2048\n101 100 4096\n'), [
    { pid: 100, ppid: 1, bytes: 2048 },
    { pid: 101, ppid: 100, bytes: 4096 },
  ]);
  assert.deepEqual(parsePsProcessTable('100 1 2\n101 100 4\n'), [
    { pid: 100, ppid: 1, bytes: 2048 },
    { pid: 101, ppid: 100, bytes: 4096 },
  ]);
});

test('session memory：按 PTY 进程树汇总内存与进程数', () => {
  const table = [
    { pid: 100, ppid: 1, bytes: 1000 },
    { pid: 101, ppid: 100, bytes: 2000 },
    { pid: 102, ppid: 101, bytes: 3000 },
    { pid: 103, ppid: 102, bytes: 4000 },
    { pid: 200, ppid: 1, bytes: 5000 },
    { pid: 201, ppid: 200, bytes: 6000 },
  ];
  const sessions = [
    { id: 'a', pty: { pid: 100 } },
    { id: 'b', pty: { pid: 200 } },
    { id: 'c', pty: { pid: 999 } },
  ];
  assert.deepEqual(sumSessionMemory(sessions, table), {
    a: { bytes: 10000, processes: 4 },
    b: { bytes: 11000, processes: 2 },
  });
});

test('session memory：collectProcessTable 可注入执行器并缓存', async () => {
  clearSessionMemoryCache();
  let calls = 0;
  const execFileFn = (_bin, _args, _opts, cb) => { calls += 1; cb(null, '10 1 1024\n11 10 2048\n', ''); };
  const t1 = await collectProcessTable({ platform: 'win32', execFileFn, now: () => 1000 });
  const t2 = await collectProcessTable({ platform: 'win32', execFileFn, now: () => 1500 });
  assert.equal(calls, 1, '2 秒内复用缓存');
  assert.equal(t1.length, 2);
  assert.equal(t2, t1);
});

test('session memory：collectSessionMemory 汇总运行中会话', async () => {
  const table = [{ pid: 7, ppid: 1, bytes: 4096 }, { pid: 8, ppid: 7, bytes: 8192 }];
  const mgr = { live: () => [{ id: 's1', pty: { pid: 7 } }, { id: 's2', pty: null }] };
  const out = await collectSessionMemory(mgr, { platform: 'win32', execFileFn: (_b, _a, _o, cb) => cb(null, `${table[0].pid} ${table[0].ppid} ${table[0].bytes}\n${table[1].pid} ${table[1].ppid} ${table[1].bytes}\n`, ''), cacheMs: 0 });
  assert.deepEqual(out, { s1: { bytes: 12288, processes: 2 } });
});
