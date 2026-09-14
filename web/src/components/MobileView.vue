<script setup lang="ts">
const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;
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
</style>
