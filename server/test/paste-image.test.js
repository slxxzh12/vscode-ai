import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { savePastedImage, decodePastedImage, MAX_PASTE_BYTES } from '../paste-image.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-paste-')); }

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('粘贴图片：写出 png 临时文件并返回绝对路径', () => {
  const dir = tmp();
  const r = savePastedImage({ dataUrl: PNG_1PX, dir, now: new Date(2026, 10, 24, 15, 30, 12), rand: () => 'abc123' });
  assert.ok(path.isAbsolute(r.path));
  assert.equal(path.dirname(r.path), dir);
  assert.equal(path.basename(r.path), 'pasted-20261124-153012-abc123.png');
  assert.equal(r.mime, 'image/png');
  const buf = fs.readFileSync(r.path);
  assert.equal(buf.length, r.bytes);
  assert.deepEqual(buf, decodePastedImage(PNG_1PX).buf);
});

test('粘贴图片：非图片 dataURL 抛 bad-image', () => {
  assert.throws(() => decodePastedImage('data:text/plain;base64,aGVsbG8='), (e) => e.code === 'bad-image');
  assert.throws(() => decodePastedImage('not-a-data-url'), (e) => e.code === 'bad-image');
});

test('粘贴图片：超大图片抛 too-large', () => {
  const big = `data:image/png;base64,${Buffer.alloc(MAX_PASTE_BYTES + 1).toString('base64')}`;
  assert.throws(() => decodePastedImage(big), (e) => e.code === 'too-large');
});
