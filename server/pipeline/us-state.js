import fs from 'node:fs';
import path from 'node:path';

export const US_STATUSES = ['pending', 'running', 'success', 'failed'];

export function emptyUsState(solutionDir = '') {
  return { solutionDir, baseline: [], revs: {}, items: {} };
}

function normalizeItem(v) {
  const it = v && typeof v === 'object' ? v : {};
  return {
    status: US_STATUSES.includes(it.status) ? it.status : 'pending',
    attempts: Number.isFinite(it.attempts) ? it.attempts : 0,
    lastJobId: typeof it.lastJobId === 'string' ? it.lastJobId : null,
    branch: typeof it.branch === 'string' ? it.branch : null,
    commit: typeof it.commit === 'string' ? it.commit : null,
    error: typeof it.error === 'string' ? it.error : null,
    lastRunAt: Number.isFinite(it.lastRunAt) ? it.lastRunAt : null,
    logFiles: Array.isArray(it.logFiles) ? it.logFiles.filter((x) => typeof x === 'string') : [],
    commands: it.commands && typeof it.commands === 'object' ? it.commands : {},
    prUrl: typeof it.prUrl === 'string' ? it.prUrl : null,
    mergeStatus: typeof it.mergeStatus === 'string' ? it.mergeStatus : null,
    mergeProvider: typeof it.mergeProvider === 'string' ? it.mergeProvider : null,
    docRev: typeof it.docRev === 'string' ? it.docRev : null,
    docAuthor: typeof it.docAuthor === 'string' ? it.docAuthor : null,
  };
}

export function normalizeUsState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = {};
  if (src.items && typeof src.items === 'object') {
    for (const [us, it] of Object.entries(src.items)) items[us] = normalizeItem(it);
  }
  const revs = {};
  if (src.revs && typeof src.revs === 'object') {
    for (const [us, r] of Object.entries(src.revs)) if (typeof r === 'string') revs[us] = r;
  }
  return {
    solutionDir: typeof src.solutionDir === 'string' ? src.solutionDir : '',
    baseline: Array.isArray(src.baseline) ? src.baseline.filter((x) => typeof x === 'string') : [],
    revs,
    items,
  };
}

export function createUsStateStore({ file, logger = console } = {}) {
  function read() {
    try {
      if (!file || !fs.existsSync(file)) return emptyUsState();
      return normalizeUsState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('us-state load failed', (e && e.message) || e);
      return emptyUsState();
    }
  }
  function write(state) {
    const next = normalizeUsState(state);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    }
    return next;
  }
  return { read, write };
}

export function resetBaseline(solutionDir, current) {
  return { solutionDir, baseline: [...current], revs: {}, items: {} };
}

// revs 可选：{ [us]: 最近一次文档提交 hash }。传入时：
// - 首次接管把基线 US 的当前修订记录下来，不触发；
// - 之后基线/已处理 US 的修订变化会重新置为 pending（文档内容变更触发）。
export function selectPending(state, current, revs = null) {
  const base = new Set(state.baseline || []);
  const revsMap = revs && typeof revs === 'object' ? revs : null;
  if (revsMap) {
    for (const us of current) {
      if (base.has(us) && state.revs[us] === undefined) state.revs[us] = String(revsMap[us] || '');
    }
  }
  for (const us of current) {
    const rev = revsMap ? String(revsMap[us] || '') : '';
    const prev = state.revs[us];
    const changed = !!(revsMap && rev && prev !== undefined && rev !== prev);
    if (base.has(us)) {
      if (!changed) continue;
      if (!state.items[us]) state.items[us] = normalizeItem({ status: 'pending' });
      else if (state.items[us].status !== 'running') state.items[us].status = 'pending';
      continue;
    }
    if (!state.items[us]) state.items[us] = normalizeItem({ status: 'pending' });
    else if (changed && state.items[us].status !== 'running') state.items[us].status = 'pending';
  }
  return current.filter((us) => state.items[us]?.status === 'pending');
}

export function markInterrupted(state) {
  for (const it of Object.values(state.items || {})) {
    if (it.status !== 'running') continue;
    it.status = 'failed';
    it.error = 'interrupted';
  }
}
