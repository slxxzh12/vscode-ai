import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const MAX_FRAMES = 1000;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function safe(id) { return ID_RE.test(String(id || '')) ? String(id) : null; }

export function createProxyCapture({ rootDir, maxBody = DEFAULT_MAX_BODY, onEvent = () => {} }) {
  const active = new Map(); // captureId -> { ruleId, state }

  function ruleDir(ruleId) { return path.join(rootDir, safe(ruleId) || '_'); }
  function indexFile(ruleId) { return path.join(ruleDir(ruleId), 'index.ndjson'); }
  function bodyPath(ruleId, id, ext) { return path.join(ruleDir(ruleId), `${id}.${ext}`); }

  function encodeFrame(opcode, payload) {
    return opcode === 0x1 ? payload.toString('utf8') : payload.toString('base64');
  }

  function summary(record) {
    return {
      id: record.id, ts: record.ts, method: record.method, url: record.url,
      status: record.status, durationMs: record.durationMs, kind: record.kind,
      state: record.state, reqBodySize: record.reqBodySize, resBodySize: record.resBodySize,
      frameCount: record.frameCount, truncated: record.truncated,
    };
  }

  function detectKind(record, hasFrames) {
    if (hasFrames) return 'ws';
    const ct = record.resHeaders ? String(record.resHeaders['content-type'] || '') : '';
    return ct.includes('text/event-stream') ? 'sse' : (record.meta?.kind || 'http');
  }

  function begin(ruleId, meta = {}) {
    const id = crypto.randomUUID();
    const record = {
      id, ts: new Date().toISOString(),
      method: meta.method || 'GET', url: meta.url || '/',
      reqHeaders: meta.headers || {},
      resHeaders: null, status: 0, kind: meta.kind || 'http', state: 'active',
      reqBodySize: 0, resBodySize: 0, frameCount: 0,
      hasReqBody: false, hasResBody: false, hasFrames: false,
      truncated: false, durationMs: 0,
      meta,
    };
    fs.mkdirSync(ruleDir(ruleId), { recursive: true });
    const state = { record, reqSize: 0, resSize: 0, reqTrunc: false, resTrunc: false, frames: [] };
    active.set(id, { ruleId, state });
    onEvent({ kind: 'capture', ruleId, record: summary(record) });
    return {
      id,
      reqBody(buf) {
        if (state.reqTrunc) return;
        const room = maxBody - state.reqSize;
        if (room <= 0) { state.reqTrunc = true; return; }
        const slice = buf.length > room ? buf.subarray(0, room) : buf;
        fs.appendFileSync(bodyPath(ruleId, id, 'req'), slice);
        state.reqSize += slice.length;
        if (slice.length < buf.length) state.reqTrunc = true;
      },
      resHeaders(h) { record.resHeaders = { ...h }; },
      resBody(buf) {
        if (state.resTrunc) return;
        const room = maxBody - state.resSize;
        if (room <= 0) { state.resTrunc = true; return; }
        const slice = buf.length > room ? buf.subarray(0, room) : buf;
        fs.appendFileSync(bodyPath(ruleId, id, 'res'), slice);
        state.resSize += slice.length;
        if (slice.length < buf.length) state.resTrunc = true;
      },
      frame(dir, opcode, payload) {
        if (state.frames.length >= MAX_FRAMES) return;
        state.frames.push({ dir, opcode, ts: Date.now(), data: encodeFrame(opcode, payload) });
      },
      finish(info = {}) {
        record.status = Number(info.status || 0);
        record.durationMs = Number(info.durationMs || 0);
        record.state = 'done';
        record.reqBodySize = state.reqSize;
        record.resBodySize = state.resSize;
        record.hasReqBody = state.reqSize > 0;
        record.hasResBody = state.resSize > 0;
        record.hasFrames = state.frames.length > 0;
        record.frameCount = state.frames.length;
        record.truncated = state.reqTrunc || state.resTrunc;
        record.kind = detectKind(record, record.hasFrames);
        fs.mkdirSync(ruleDir(ruleId), { recursive: true });
        if (record.hasFrames) {
          const lines = state.frames.map((f) => JSON.stringify(f)).join('\n') + '\n';
          fs.writeFileSync(bodyPath(ruleId, id, 'frames.ndjson'), lines, 'utf8');
        }
        fs.writeFileSync(bodyPath(ruleId, id, 'json'), JSON.stringify(record), 'utf8');
        fs.appendFileSync(indexFile(ruleId), JSON.stringify(summary(record)) + '\n');
        active.delete(id);
        onEvent({ kind: 'capture', ruleId, record: summary(record) });
      },
    };
  }

  function list(ruleId, { limit = 200 } = {}) {
    const out = [];
    for (const [, v] of active) if (v.ruleId === ruleId) out.push(summary(v.state.record));
    try {
      const lines = fs.readFileSync(indexFile(ruleId), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) { try { out.push(JSON.parse(line)); } catch { /* skip */ } }
    } catch { /* no index yet */ }
    out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return out.slice(-limit);
  }

  function read(ruleId, id) {
    const sid = safe(id);
    if (!sid) { const e = new Error('bad id'); e.code = 'bad-request'; throw e; }
    const raw = JSON.parse(fs.readFileSync(bodyPath(ruleId, sid, 'json'), 'utf8'));
    const readBody = (ext) => { try { return fs.readFileSync(bodyPath(ruleId, sid, ext), 'utf8'); } catch { return ''; } };
    let frames = [];
    try {
      frames = fs.readFileSync(bodyPath(ruleId, sid, 'frames.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* none */ }
    return { record: raw, reqBody: readBody('req'), resBody: readBody('res'), frames };
  }

  function clear(ruleId) {
    try { fs.rmSync(ruleDir(ruleId), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  function removeRule(ruleId) { clear(ruleId); }

  return { begin, list, read, clear, removeRule };
}
