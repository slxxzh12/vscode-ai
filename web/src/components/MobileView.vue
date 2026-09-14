<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';

const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
const DESKTOP_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
const TUTORIAL_URL = 'https://space.bilibili.com/1933375113';
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
    <section class="notice">
      <h3 class="ntitle">📢 {{ $t('mobile.notice') }}</h3>
      <div v-if="noticeHtml" class="nbody" v-html="noticeHtml"></div>
      <div v-else class="hint">{{ noticeEmpty || $t('mobile.notice_empty') }}</div>
    </section>

    <header class="hero">
      <h2 class="title">{{ $t('mobile.title') }}</h2>
      <p class="desc">{{ $t('mobile.desc') }}</p>
      <p class="pair">{{ $t('mobile.pair_hint') }}</p>
    </header>

    <ul class="feats">
      <li>{{ $t('mobile.feat.terminal') }}</li>
      <li>{{ $t('mobile.feat.review') }}</li>
      <li>{{ $t('mobile.feat.pair') }}</li>
    </ul>

    <div class="cards">
      <section class="card">
        <div class="ctitle">💻 {{ $t('mobile.desktop') }}</div>
        <a class="link big addr" :href="DESKTOP_URL" target="_blank" rel="noopener">{{ DESKTOP_URL }}</a>
        <div class="hint">{{ $t('mobile.desktop_hint') }}</div>
      </section>
      <section class="card">
        <div class="ctitle">📱 {{ $t('mobile.mobile') }}</div>
        <img class="qr" :src="qrMobile" :alt="$t('mobile.mobile')" width="168" height="168" />
        <a class="link addr" :href="MOBILE_URL" target="_blank" rel="noopener">{{ MOBILE_URL }}</a>
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
      </section>
    </div>

    <div class="tutlink">🎬 {{ $t('mobile.tutorial') }} <a class="link addr" :href="TUTORIAL_URL" target="_blank" rel="noopener">{{ TUTORIAL_URL }}</a></div>
  </div>
</template>

<style scoped>
.mobile { padding: 24px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); }
.hero { max-width: 560px; }
.title { margin: 0 0 8px; color: var(--tx1); font-size: 22px; }
.desc { margin: 0; color: var(--tx3); font-size: 14px; line-height: 1.6; }
.pair { margin: 8px 0 0; color: var(--tx4); font-size: 12px; line-height: 1.6; }
.feats { margin: 18px 0 22px; padding-left: 20px; color: var(--tx2); font-size: 13px; line-height: 2; }
.cards { display: flex; flex-wrap: wrap; gap: 16px; }
.card { width: 240px; border: 1px solid var(--bd); border-radius: 8px; padding: 16px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ctitle { font-weight: 700; color: var(--tx1); font-size: 13px; }
.qr { background: #fff; border-radius: 6px; padding: 8px; box-sizing: content-box; }
.hint { color: var(--tx4); font-size: 12px; }
.link { color: var(--ac2); font-size: 12px; text-decoration: none; }
.link.big { font-size: 14px; font-weight: 600; }
.addr { word-break: break-all; text-align: center; line-height: 1.5; }
.link:hover { text-decoration: underline; }
.tutlink { margin-top: 16px; color: var(--tx3); font-size: 13px; }

.notice { margin: 0 0 22px; max-width: 720px; border: 1px solid var(--bd); border-radius: 8px; padding: 14px 18px; background: var(--bg2); }
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
