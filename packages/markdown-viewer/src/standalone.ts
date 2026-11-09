import { createApp, h } from 'vue';
import MarkdownViewer from './vue/MarkdownViewer.vue';

type StandaloneConfig = {
  content?: string;
  html?: string;
  theme?: 'dark' | 'light' | 'auto';
  locale?: 'zh-CN' | 'en';
  ppt?: boolean;
};

function readConfig(): StandaloneConfig {
  const node = document.getElementById('mdv-config');
  if (!node || !node.textContent) return {};
  try {
    return JSON.parse(node.textContent) as StandaloneConfig;
  } catch {
    return {};
  }
}

function mountOne(root: HTMLElement) {
  const cfg = readConfig();
  const html = cfg.html ?? (cfg.content ? undefined : root.innerHTML);
  const host = document.createElement('div');
  root.replaceWith(host);
  createApp({
    render: () => h(MarkdownViewer, { ...cfg, html }),
  }).mount(host);
}

function boot() {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>('article.md-page[data-mdv]'))) {
    mountOne(root);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
