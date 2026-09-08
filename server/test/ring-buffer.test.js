import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../ring-buffer.js';

test('容量内完整保留', () => {
  const rb = new RingBuffer(100);
  rb.push('line1\nline2\n');
  assert.equal(rb.content, 'line1\nline2\n');
});

test('超限后只从行首截断', () => {
  const rb = new RingBuffer(12);
  rb.push('aaaaaaaaaa\n');
  rb.push('bbbbbbbbbb\n');
  assert.equal(rb.content, 'bbbbbbbbbb\n');
  assert.ok(!rb.content.includes('aaaaaaaaaa'));
});

test('单块超限且无换行则整块丢弃', () => {
  const rb = new RingBuffer(8);
  rb.push('0123456789');
  assert.equal(rb.content, '');
});

test('截断边界以完整行/序列开头（不夹半截转义）', () => {
  const rb = new RingBuffer(20);
  rb.push('\x1b[31mred\x1b[0m\n');
  rb.push('\x1b[32mgreen\x1b[0m\n');
  rb.push('tail\n');
  const c = rb.content;
  assert.ok(c.startsWith('\x1b[32mgreen'));   // 从整行完整转义序列开始
  assert.ok(!c.includes('red'));
  assert.ok(c.endsWith('tail\n'));
});

test('字节上限按 Buffer 长度计', () => {
  const rb = new RingBuffer(12);
  rb.push('abc\n');
  rb.push('\u4f60\u597d\n');
  rb.push('xy\n');
  assert.equal(rb.content, '\u4f60\u597d\nxy\n');
});
