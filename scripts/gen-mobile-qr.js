import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS_URL = 'https://apps.apple.com/app/id0000000000';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.devflow.app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web', 'public', 'mobile');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { url: IOS_URL, out: path.join(outDir, 'qr-ios.svg') },
  { url: ANDROID_URL, out: path.join(outDir, 'qr-android.svg') },
];

for (const { url, out } of targets) {
  execFileSync('npx', ['--yes', 'qrcode', '-t', 'svg', '-o', out, url], { stdio: 'inherit', shell: true });
  console.log('generated', path.relative(root, out));
}
