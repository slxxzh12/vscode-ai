import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web', 'public', 'mobile');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { url: MOBILE_URL, out: path.join(outDir, 'qr-mobile.svg') },
];

for (const { url, out } of targets) {
  execFileSync('npx', ['--yes', 'qrcode', '-t', 'svg', '-o', out, url], { stdio: 'inherit', shell: true });
  console.log('generated', path.relative(root, out));
}
