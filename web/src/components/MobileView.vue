<script setup lang="ts">
const IOS_URL = 'https://apps.apple.com/app/id0000000000';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.devflow.app';
const base = import.meta.env.BASE_URL;
const qrIos = `${base}mobile/qr-ios.svg`;
const qrAndroid = `${base}mobile/qr-android.svg`;
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
        <div class="chead">
          <span class="platform">{{ $t('mobile.ios') }}</span>
          <span class="badge">{{ $t('mobile.coming_soon') }}</span>
        </div>
        <img class="qr" :src="qrIos" :alt="$t('mobile.ios')" width="168" height="168" />
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        <a class="link" :href="IOS_URL" target="_blank" rel="noopener">App Store</a>
      </section>

      <section class="card">
        <div class="chead">
          <span class="platform">{{ $t('mobile.android') }}</span>
          <span class="badge">{{ $t('mobile.coming_soon') }}</span>
        </div>
        <img class="qr" :src="qrAndroid" :alt="$t('mobile.android')" width="168" height="168" />
        <div class="hint">{{ $t('mobile.scan_hint') }}</div>
        <a class="link" :href="ANDROID_URL" target="_blank" rel="noopener">Google Play</a>
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
.chead { width: 100%; display: flex; align-items: center; justify-content: space-between; }
.platform { font-weight: 700; color: var(--tx1); }
.badge { font-size: 11px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; }
.qr { background: #fff; border-radius: 6px; padding: 8px; box-sizing: content-box; }
.hint { color: var(--tx4); font-size: 12px; }
.link { color: var(--ac2); font-size: 12px; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
