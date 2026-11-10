import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';

const external = [
  'vue',
  'element-plus',
  'echarts',
  'echarts/core',
  'echarts/charts',
  'echarts/components',
  'echarts/renderers',
  'mermaid',
  '@antv/x6',
  '@dagrejs/dagre',
  'markdown-it',
  'highlight.js',
  'dompurify',
  'pptxgenjs',
  'html-to-image',
];

export default defineConfig({
  plugins: [vue(), dts({ include: ['src/**/*.ts', 'src/**/*.vue'], outDir: 'dist' })],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { external },
    cssCodeSplit: false,
  },
});
