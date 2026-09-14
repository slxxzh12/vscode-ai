import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import versionMod from '@devflow/shared/version.cjs';

const { todayVersion } = versionMod;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveVersion(root = path.join(__dirname, '..')) {
  const override = String(process.env.DEVFLOW_VERSION || '').trim();
  if (override) return override;
  try {
    const frozen = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
    if (frozen) return frozen;
  } catch { /* no frozen version.txt -> dev fallback */ }
  return todayVersion();
}

export const VERSION = resolveVersion();
