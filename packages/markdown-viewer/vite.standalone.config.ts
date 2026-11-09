import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/standalone.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    outDir: 'dist/standalone',
    emptyOutDir: true,
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
    cssCodeSplit: false,
  },
});
