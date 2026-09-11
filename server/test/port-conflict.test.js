import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseListeningPids, findPidsOnPort, killPids, isPortFree } from '../port-conflict.js';

const NETSTAT = [
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:22222          0.0.0.0:0              LISTENING       4321',
  '  TCP    127.0.0.1:22222        0.0.0.0:0              LISTENING       4321',
  '  TCP    [::]:22222             [::]:0                 LISTENING       9876',
  '  TCP    127.0.0.1:22223        0.0.0.0:0              LISTENING       5555',
  '  TCP    127.0.0.1:22222        127.0.0.1:50000        ESTABLISHED     6666',
  '  UDP    0.0.0.0:22222          *:*                                    7777',
].join('\r\n');

test('parseListeningPids 只取目标端口的 LISTENING 去重', () => {
  assert.deepEqual(parseListeningPids(NETSTAT, 22222).sort((a, b) => a - b), [4321, 9876]);
});

test('parseListeningPids 其他端口不误伤', () => {
  assert.deepEqual(parseListeningPids(NETSTAT, 22223), [5555]);
});

test('findPidsOnPort 用注入的 exec 解析 netstat', async () => {
  const calls = [];
  const exec = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); cb(null, NETSTAT); };
  const pids = await findPidsOnPort(22222, { exec });
  assert.deepEqual(pids.sort((a, b) => a - b), [4321, 9876]);
  assert.deepEqual(calls[0], ['netstat', '-ano', '-p', 'tcp']);
});

test('killPids 逐 PID 调 taskkill /F /T', async () => {
  const calls = [];
  const exec = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); cb(null, ''); };
  const killed = await killPids([4321, 9876], { exec });
  assert.deepEqual(killed, [4321, 9876]);
  assert.deepEqual(calls, [
    ['taskkill', '/F', '/T', '/PID', '4321'],
    ['taskkill', '/F', '/T', '/PID', '9876'],
  ]);
});

test('isPortFree 已占用端口返回 false', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  assert.equal(await isPortFree('127.0.0.1', port), false);
  await new Promise((r) => srv.close(r));
});

test('isPortFree 空闲端口返回 true', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  assert.equal(await isPortFree('127.0.0.1', port), true);
});
