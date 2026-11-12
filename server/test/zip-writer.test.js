import { test } from 'node:test';
import assert from 'node:assert/strict';
import yauzl from 'yauzl';
import { createZip, crc32 } from '../zip-writer.js';

function unzip(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err) { reject(err); return; }
      const out = {};
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        zipfile.openReadStream(entry, (e, stream) => {
          if (e) { reject(e); return; }
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => { out[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zipfile.readEntry(); });
        });
      });
      zipfile.on('end', () => resolve(out));
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

test('crc32 与已知值一致', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('createZip：可被 yauzl 读回，保留中文路径与内容', async () => {
  const zip = createZip([
    { path: 'a/b.txt', data: 'hello' },
    { path: '中文/数据.csv', data: '\uFEFFx,y\r\n1,2\r\n' },
    { path: 'empty.txt', data: '' },
  ], { date: new Date(2026, 0, 2, 3, 4, 6) });
  const files = await unzip(zip);
  assert.equal(files['a/b.txt'], 'hello');
  assert.equal(files['中文/数据.csv'], '\uFEFFx,y\r\n1,2\r\n');
  assert.equal(files['empty.txt'], '');
});

test('createZip：路径反斜杠归一为正斜杠', async () => {
  const zip = createZip([{ path: 'x\\y.txt', data: 'z' }]);
  const files = await unzip(zip);
  assert.equal(files['x/y.txt'], 'z');
});
