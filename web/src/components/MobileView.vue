<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';

const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;

const noticeHtml = ref('');
const noticeEmpty = ref('');

onMounted(async () => {
  try {
    const r = await fetch('/api/notice').then((x) => x.json());
    if (r && r.ok && typeof r.content === 'string' && r.content.trim()) {
      noticeHtml.value = renderRemoteMarkdown(r.content);
    } else {
      noticeEmpty.value = t('mobile.notice_empty');
    }
  } catch {
    noticeEmpty.value = t('mobile.notice_empty');
  }
});
</script>

<template>
  <div class="mobile">
    <header class="hero">
      <h2 class="title">{{ $t('mobile.title') }}</h2>
      <p class="desc">{{ $t('mobile.desc') }}</p>
    </header>

    <ul class="feats">
      <li>{{ $t('mobile.feat.terminal') }}</li>
      <li>{{ $t('mobile.feat.review') }}</li>
      <li>{{ $t('mobile.feat.pair') }}</li>
    </ul>

    <div class="cards">
      <section class="card">
        <img class="qr" :src="qrMobile" :alt="$t('mobile.title')" width="168" height="168" />
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        <a class="link" :href="MOBILE_URL" target="_blank" rel="noopener">{{ $t('mobile.download') }}</a>
      </section>
    </div>

    <section class="notice">
      <h3 class="ntitle">📢 {{ $t('mobile.notice') }}</h3>
      <div v-if="noticeHtml" class="nbody" v-html="noticeHtml"></div>
      <div v-else class="hint">{{ noticeEmpty || $t('mobile.notice_empty') }}</div>
    </section>
  </div>
</template>

<style scoped>
.mobile { padding: 24px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); }
.hero { max-width: 560px; }
.title { margin: 0 0 8px; color: var(--tx1); font-size: 22px; }
.desc { margin: 0; color: var(--tx3); font-size: 14px; line-height: 1.6; }
.feats { margin: 18px 0 22px; padding-left: 20px; color: var(--tx2); font-size: 13px; line-height: 2; }
.cards { display: flex; flex-wrap: wrap; gap: 16px; }
.card { width: 240px; border: 1px solid var(--bd); border-radius: 8px; padding: 16px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.qr { background: #fff; border-radius: 6px; padding: 8px; box-sizing: content-box; }
.hint { color: var(--tx4); font-size: 12px; }
.link { color: var(--ac2); font-size: 12px; text-decoration: none; }
.link:hover { text-decoration: underline; }

.notice { margin-top: 26px; max-width: 720px; border: 1px solid var(--bd); border-radius: 8px; padding: 14px 18px; background: var(--bg2); }
.ntitle { margin: 0 0 10px; color: var(--tx1); font-size: 15px; }
.nbody { color: var(--tx2); font-size: 13px; line-height: 1.75; }
.nbody :deep(h1) { font-size: 18px; margin: 0.6em 0 0.4em; }
.nbody :deep(h2) { font-size: 16px; margin: 0.6em 0 0.4em; }
.nbody :deep(h3) { font-size: 14px; margin: 0.6em 0 0.4em; }
.nbody :deep(p) { margin: 0.5em 0; }
.nbody :deep(a) { color: var(--ac2); text-decoration: none; }
.nbody :deep(a:hover) { text-decoration: underline; }
.nbody :deep(ul), .nbody :deep(ol) { margin: 0.5em 0; padding-left: 1.6em; }
.nbody :deep(li) { margin: 0.2em 0; }
.nbody :deep(code) { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: var(--bg1); padding: 1px 5px; border-radius: 4px; }
.nbody :deep(pre) { background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; overflow: auto; }
.nbody :deep(pre code) { background: transparent; padding: 0; }
.nbody :deep(blockquote) { margin: 0.6em 0; padding: 0.1em 0.9em; border-left: 3px solid var(--ac2); color: var(--tx3); }
.nbody :deep(img) { max-width: 100%; border-radius: 6px; }
.nbody :deep(hr) { border: none; border-top: 1px solid var(--bd); margin: 1em 0; }
.nbody :deep(table) { border-collapse: collapse; margin: 0.6em 0; }
.nbody :deep(th), .nbody :deep(td) { border: 1px solid var(--bd); padding: 4px 10px; }
</style>
