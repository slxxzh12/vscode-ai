import fs from 'node:fs';
import path from 'node:path';

export const US_STATUSES = ['pending', 'running', 'success', 'failed'];

export function emptyUsState(solutionDir = '') {
  return { solutionDir, baseline: [], items: {} };
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
  };
}

export function normalizeUsState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = {};
  if (src.items && typeof src.items === 'object') {
    for (const [us, it] of Object.entries(src.items)) items[us] = normalizeItem(it);
  }
  return {
    solutionDir: typeof src.solutionDir === 'string' ? src.solutionDir : '',
    baseline: Array.isArray(src.baseline) ? src.baseline.filter((x) => typeof x === 'string') : [],
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
  return { solutionDir, baseline: [...current], items: {} };
}

export function selectPending(state, current) {
  const base = new Set(state.baseline || []);
  for (const us of current) {
    if (base.has(us)) continue;
    if (!state.items[us]) state.items[us] = normalizeItem({ status: 'pending' });
  }
  return current.filter((us) => !base.has(us) && state.items[us]?.status === 'pending');
}

export function markInterrupted(state) {
  for (const it of Object.values(state.items || {})) {
    if (it.status !== 'running') continue;
    it.status = 'failed';
    it.error = 'interrupted';
  }
}
