import fs from 'node:fs';
import path from 'node:path';

export function emptyPeers() {
  return { updatedAt: 0, peers: {} };
}

// master 侧上报库：每台机器只留最新一份（按 machineId upsert）
export class UsagePeersStore {
  constructor({ file, logger = console }) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
  }

  _load() {
    if (!this.file || !fs.existsSync(this.file)) return emptyPeers();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const peers = raw && typeof raw.peers === 'object' && raw.peers ? raw.peers : {};
      return { updatedAt: Number(raw && raw.updatedAt) || 0, peers };
    } catch (e) {
      this.log?.warn?.('usage-peers load failed', (e && e.message) || e);
      return emptyPeers();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      this.log?.warn?.('usage-peers save failed', (e && e.message) || e);
    }
    return this.data;
  }

  upsert(usage, now = Date.now()) {
    const machineId = String((usage && usage.machineId) || '');
    if (!machineId) return null;
    this.data.peers[machineId] = { ...usage, machineId, receivedAt: now };
    this.data.updatedAt = now;
    this.save();
    return this.data.peers[machineId];
  }

  list() { return this.data.peers; }
  get(machineId) { return this.data.peers[machineId] || null; }
  snapshot() { return { updatedAt: this.data.updatedAt, peers: this.data.peers }; }
}
