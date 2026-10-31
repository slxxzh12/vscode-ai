const LF = 0x0a;

export class RingBuffer {
  constructor(maxBytes = 256 * 1024) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.length = 0;
  }
  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.length += buf.length;
    this._trim();
  }
  _trim() {
    while (this.length > this.maxBytes && this.chunks.length > 0) {
      const head = this.chunks[0];
      const idx = head.indexOf(LF);
      if (idx >= 0) {
        const keep = head.subarray(idx + 1);
        this.length -= idx + 1;
        if (keep.length > 0) this.chunks[0] = keep;
        else this.chunks.shift();
      } else {
        this.length -= head.length;
        this.chunks.shift();
      }
    }
  }
  get content() {
    return this.chunks.length ? Buffer.concat(this.chunks).toString('utf8') : '';
  }
}
