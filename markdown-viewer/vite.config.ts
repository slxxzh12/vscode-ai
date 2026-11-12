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

// 默认生成 .d.ts（直接跑 `npm --prefix markdown-viewer run build` 时保持旧行为）；
// 日常构建由 scripts/build-mdv.js 传 DEVFLOW_MDV_DTS=0 跳过，typecheck 时传 1。
const withDts = process.env.DEVFLOW_MDV_DTS !== '0';

export default defineConfig({
  plugins: [
    vue(),
    ...(withDts ? [dts({ include: ['src/**/*.ts', 'src/**/*.vue'], outDir: 'dist' })] : []),
  ],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    outDir: 'dist',
    // 不清理整个 dist：standalone 在 dist/standalone 下，单独构建 main 时不能把它删掉；
    // main 的产物是固定文件名（index.js / style.css），不会累积旧 chunk。
    emptyOutDir: false,
    rollupOptions: { external },
    cssCodeSplit: false,
  },
});
