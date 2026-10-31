// 最小 WebSocket 帧解析（仅用于抓包；不参与转发，转发是原始字节 pipe）
const MAX_FRAME = 16 * 1024 * 1024;

export class WsFrameParser {
  constructor(masked = false) {
    this.masked = masked;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      const f = this.tryParse();
      if (!f) break;
      frames.push(f);
    }
    return frames;
  }

  tryParse() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) { this.buf = Buffer.alloc(0); return null; }
      len = Number(big); off = 10;
    }
    if (len > MAX_FRAME) { this.buf = Buffer.alloc(0); return null; }
    let maskKey = null;
    if (masked) {
      if (b.length < off + 4) return null;
      maskKey = b.subarray(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;
    let payload = b.subarray(off, off + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }
}

// 文本帧原样；其它（二进制/控制帧）base64
export function encodeFrameData(opcode, payload) {
  if (opcode === 0x1) return payload.toString('utf8');
  return payload.toString('base64');
}
