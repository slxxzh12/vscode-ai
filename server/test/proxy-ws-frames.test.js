import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsFrameParser, encodeFrameData } from '../proxy-ws-frames.js';

// 手工构造一个未分片帧；masked=true 时按客户端帧加掩码
function makeFrame(opcode, payload, masked) {
  const data = Buffer.from(payload);
  const len = data.length;
  const parts = [Buffer.from([0x80 | opcode, (masked ? 0x80 : 0) | len])];
  if (masked) {
    const key = Buffer.from([1, 2, 3, 4]);
    parts.push(key);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = data[i] ^ key[i & 3];
    parts.push(out);
  } else {
    parts.push(data);
  }
  return Buffer.concat(parts);
}

test('解析单个文本帧', () => {
  const p = new WsFrameParser(false);
  const frames = p.push(makeFrame(0x1, 'hello', false));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 0x1);
  assert.equal(encodeFrameData(0x1, frames[0].payload), 'hello');
});

test('解析带掩码的客户端帧', () => {
  const p = new WsFrameParser(true);
  const frames = p.push(makeFrame(0x1, 'abc', true));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString('utf8'), 'abc');
});

test('分片到达时缓冲直到完整', () => {
  const p = new WsFrameParser(false);
  const full = makeFrame(0x1, 'streamed', false);
  assert.deepEqual(p.push(full.subarray(0, 2)), []);
  const frames = p.push(full.subarray(2));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString('utf8'), 'streamed');
});

test('一个 chunk 含多帧', () => {
  const p = new WsFrameParser(false);
  const frames = p.push(Buffer.concat([makeFrame(0x1, 'a', false), makeFrame(0x1, 'b', false)]));
  assert.equal(frames.length, 2);
});

test('encodeFrameData：二进制帧 base64', () => {
  assert.equal(encodeFrameData(0x2, Buffer.from([0, 1, 2])), Buffer.from([0, 1, 2]).toString('base64'));
});
