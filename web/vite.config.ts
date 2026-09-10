import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function configPort(): number {
  try {
    const xml = fs.readFileSync(path.join(__dirname, '..', 'config', 'devflow.xml'), 'utf8');
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    if (m) return Number(m[1]);
  } catch { /* ignore */ }
  return 3001;
}
const PORT = Number(process.env.DEVFLOW_PORT || configPort());

export default defineConfig({
  plugins: [vue()],
  server: {
    watch: { ignored: ['**/*.tmp', '**/node_modules/**'] },
    proxy: {
      '/api': { target: `http://127.0.0.1:${PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${PORT}`, ws: true },
    },
  },
  build: { outDir: 'dist' },
});
