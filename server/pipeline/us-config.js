import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_US_CONFIG = { autoDev: false, autoMerge: false, watch: false };

export function normalizeUsConfig(raw) {
  const autoDev = raw?.autoDev === true;
  // 方案监控依赖自动编码能力：自动开发关闭时监控也一并关闭。
  return { autoDev, autoMerge: raw?.autoMerge === true, watch: autoDev && raw?.watch === true };
}

export function createUsConfigStore({ file, logger = console } = {}) {
  function read() {
    try {
      if (!file || !fs.existsSync(file)) return { ...DEFAULT_US_CONFIG };
      return normalizeUsConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      logger?.warn?.('us-config load failed', (e && e.message) || e);
      return { ...DEFAULT_US_CONFIG };
    }
  }
  function write(input) {
    const cfg = normalizeUsConfig(input);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    }
    return cfg;
  }
  return { read, write };
}
