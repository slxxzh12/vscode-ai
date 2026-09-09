import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, readZip, safeZipName } from '../collaboration/zip.js';

test('zip 往返一致（含子目录/二进制/空文件）', () => {
  const entries = [
    { name: 'demo/SKILL.md', data: Buffer.from('# demo\n```js\nconst a=1;\n```\n', 'utf8') },
    { name: 'demo/scripts/run.js', data: Buffer.from('console.log("ok")\n', 'utf8') },
    { name: 'demo/blob.bin', data: Buffer.from([0, 1, 2, 255, 128, 7]) },
    { name: 'demo/empty.txt', data: Buffer.alloc(0) },
  ];
  const buf = buildZip(entries);
  const out = readZip(buf);
  assert.equal(out.length, entries.length);
  for (const e of entries) {
    const got = out.find((x) => x.name === e.name);
    assert.ok(got, `missing ${e.name}`);
    assert.deepEqual(got.data, e.data);
  }
});

test('safeZipName 拒绝越界/绝对/反斜杠', () => {
  assert.equal(safeZipName('demo/SKILL.md'), true);
  assert.equal(safeZipName('demo/scripts/run.js'), true);
  assert.equal(safeZipName('../evil'), false);
  assert.equal(safeZipName('demo/../../evil'), false);
  assert.equal(safeZipName('/abs/x'), false);
  assert.equal(safeZipName('a\\b'), false);
  assert.equal(safeZipName(''), false);
});

test('readZip 正常读回合法包', () => {
  const buf = buildZip([{ name: 'ok/x', data: Buffer.from('hi') }]);
  assert.equal(readZip(buf)[0].name, 'ok/x');
});
