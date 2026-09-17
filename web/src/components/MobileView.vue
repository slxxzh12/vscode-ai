<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { locale, t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';
import MiniTools from './MiniTools.vue';

const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
const DESKTOP_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
const TUTORIAL_URL = 'https://space.bilibili.com/1933375113';
const ISSUES_URL = 'https://gitee.com/slxxzh12/vscode-ai/issues';
const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;

const noticeHtml = ref('');
const noticeEmpty = ref('');

async function loadNotice() {
  try {
    const r = await fetch(`/api/notice?lang=${encodeURIComponent(locale.value)}`).then((x) => x.json());
    if (r && r.ok && typeof r.content === 'string' && r.content.trim()) {
      noticeHtml.value = renderRemoteMarkdown(r.content);
      noticeEmpty.value = '';
    } else {
      noticeHtml.value = '';
      noticeEmpty.value = t('mobile.notice_empty');
    }
  } catch {
    noticeHtml.value = '';
    noticeEmpty.value = t('mobile.notice_empty');
  }
}

onMounted(loadNotice);
watch(locale, loadNotice);
</script>

<template>
  <div class="mobile">
    <div class="col-main">
      <section class="feedback">
        <h3 class="ftitle">🐞 {{ $t('mobile.feedback.title') }}</h3>
        <p class="fhint">{{ $t('mobile.feedback.hint') }}</p>
        <a class="link" :href="ISSUES_URL" target="_blank" rel="noopener">{{ $t('mobile.feedback.link') }} →</a>
      </section>

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

      <section class="gitnote">
        <h3 class="gtitle">🔗 {{ $t('mobile.git.title') }}</h3>
        <ul class="glist">
          <li>{{ $t('mobile.git.same') }}</li>
          <li>{{ $t('mobile.git.reachable') }}</li>
          <li>{{ $t('mobile.git.check') }}</li>
        </ul>
      </section>

      <div class="cards">
        <section class="card">
          <div class="ctitle">💻 {{ $t('mobile.desktop') }}</div>
          <a class="link big addr" :href="DESKTOP_URL" target="_blank" rel="noopener">{{ DESKTOP_URL }}</a>
          <div class="hint">{{ $t('mobile.desktop_hint') }}</div>
        </section>
        <section class="card">
          <div class="ctitle">📱 {{ $t('mobile.mobile') }}</div>
          <img class="qr" :src="qrMobile" :alt="$t('mobile.mobile')" width="132" height="132" />
          <a class="link addr" :href="MOBILE_URL" target="_blank" rel="noopener">{{ MOBILE_URL }}</a>
          <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        </section>
      </div>

      <div class="tutlink">🎬 {{ $t('mobile.tutorial') }} <a class="link addr" :href="TUTORIAL_URL" target="_blank" rel="noopener">{{ TUTORIAL_URL }}</a></div>

      <div class="footlink">🐞 {{ $t('mobile.feedback.title') }} <a class="link addr" :href="ISSUES_URL" target="_blank" rel="noopener">{{ ISSUES_URL }}</a></div>
    </div>

    <aside class="col-tools">
      <MiniTools />
    </aside>
  </div>
</template>

<style scoped>
.mobile { padding: 14px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); display: flex; gap: 16px; align-items: flex-start; }
.col-main { flex: 1 1 auto; min-width: 0; }
.col-tools { flex: 0 0 220px; min-width: 0; }
.hero { max-width: 560px; }
.title { margin: 0 0 4px; color: var(--tx1); font-size: 18px; }
.desc { margin: 0; color: var(--tx3); font-size: 13px; line-height: 1.5; }
.pair { margin: 4px 0 0; color: var(--tx4); font-size: 11px; line-height: 1.5; }
.feats { margin: 10px 0 12px; padding-left: 18px; color: var(--tx2); font-size: 12px; line-height: 1.7; }
.gitnote { max-width: 560px; margin: 0 0 12px; border: 1px solid var(--bd); border-left: 3px solid var(--ac2); border-radius: 8px; padding: 9px 12px; background: var(--bg2); }
.gtitle { margin: 0 0 4px; color: var(--tx1); font-size: 12px; }
.glist { margin: 0; padding-left: 16px; color: var(--tx3); font-size: 11px; line-height: 1.6; }
.glist li { margin: 1px 0; }
.feedback { max-width: 560px; margin: 0 0 12px; border: 1px solid var(--bd); border-left: 3px solid var(--ac); border-radius: 8px; padding: 9px 12px; background: var(--bg2); }
.ftitle { margin: 0 0 4px; color: var(--tx1); font-size: 12px; }
.fhint { margin: 0 0 6px; color: var(--tx3); font-size: 11px; line-height: 1.6; }
.footlink { margin-top: 6px; color: var(--tx3); font-size: 12px; }
.cards { display: flex; flex-wrap: wrap; gap: 10px; }.card { width: 200px; border: 1px solid var(--bd); border-radius: 8px; padding: 12px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ctitle { font-weight: 700; color: var(--tx1); font-size: 12px; }
.qr { background: #fff; border-radius: 6px; padding: 6px; box-sizing: content-box; }
.hint { color: var(--tx4); font-size: 11px; }
.link { color: var(--ac2); font-size: 11px; text-decoration: none; }
.link.big { font-size: 13px; font-weight: 600; }
.addr { word-break: break-all; text-align: center; line-height: 1.4; }
.link:hover { text-decoration: underline; }
.tutlink { margin-top: 10px; color: var(--tx3); font-size: 12px; }

.notice { margin: 0 0 12px; border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); }
.ntitle { margin: 0 0 6px; color: var(--tx1); font-size: 13px; }
.nbody { color: var(--tx2); font-size: 12px; line-height: 1.6; }
.nbody :deep(h1) { font-size: 16px; margin: 0.5em 0 0.3em; }
.nbody :deep(h2) { font-size: 14px; margin: 0.5em 0 0.3em; }
.nbody :deep(h3) { font-size: 13px; margin: 0.5em 0 0.3em; }
.nbody :deep(p) { margin: 0.4em 0; }
.nbody :deep(a) { color: var(--ac2); text-decoration: none; }
.nbody :deep(a:hover) { text-decoration: underline; }
.nbody :deep(ul), .nbody :deep(ol) { margin: 0.4em 0; padding-left: 1.5em; }
.nbody :deep(li) { margin: 0.1em 0; }
.nbody :deep(code) { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: var(--bg1); padding: 1px 5px; border-radius: 4px; }
.nbody :deep(pre) { background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; overflow: auto; }
.nbody :deep(pre code) { background: transparent; padding: 0; }
.nbody :deep(blockquote) { margin: 0.5em 0; padding: 0.1em 0.8em; border-left: 3px solid var(--ac2); color: var(--tx3); }
.nbody :deep(img) { max-width: 100%; border-radius: 6px; }
.nbody :deep(hr) { border: none; border-top: 1px solid var(--bd); margin: 0.8em 0; }
.nbody :deep(table) { border-collapse: collapse; margin: 0.5em 0; }
.nbody :deep(th), .nbody :deep(td) { border: 1px solid var(--bd); padding: 3px 8px; }

@media (max-width: 760px) {
  .mobile { flex-direction: column; }
  .col-tools { flex: none; width: 100%; }
}
</style>
