<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { locale, t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';
import MiniTools from './MiniTools.vue';
import { useCollab } from '../collaboration/useCollab';
import { useVersion } from '../useVersion';
import {
  ISSUES_URL, MARKET_CLIENTS, TUTORIAL_URL,
  fmtSize, groupDownloadFiles, installableOf, marketKindKey, type DownloadFile,
} from '../marketApps';

const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;

const collab = useCollab();
const { version, loadVersion } = useVersion();

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
      noticeEmpty.value = t('market.notice_empty');
    }
  } catch {
    noticeHtml.value = '';
    noticeEmpty.value = t('market.notice_empty');
  }
}

const files = ref<DownloadFile[]>([]);
const groups = computed(() => groupDownloadFiles(files.value));
const installing = ref('');
const installMsg = ref('');

async function loadFiles() {
  try {
    const r = await collab.listDownloads();
    files.value = (r.manifest?.files || []) as DownloadFile[];
  } catch {
    files.value = [];
  }
}

async function install(name: string) {
  if (installing.value) return;
  installing.value = name;
  installMsg.value = '';
  try {
    const r = await collab.installDownload(name);
    installMsg.value = r.code === 'ok' ? t('market.installed') : t('market.install_failed', { msg: r.code });
  } catch (e) {
    installMsg.value = t('market.install_failed', { msg: (e as Error).message || String(e) });
  } finally {
    installing.value = '';
    await loadFiles();
  }
}

function whenLabel(ms: number): string {
  try { return new Date(Number(ms) || 0).toLocaleDateString(); } catch { return ''; }
}

onMounted(() => { void loadNotice(); void loadVersion(); void loadFiles(); });
watch(locale, loadNotice);
</script>

<template>
  <div class="market">
    <section class="notice">
      <h3 class="ntitle">📢 {{ $t('market.notice') }}</h3>
      <div v-if="noticeHtml" class="nbody" v-html="noticeHtml"></div>
      <div v-else class="hint">{{ noticeEmpty || $t('market.notice_empty') }}</div>
    </section>

    <section class="block">
      <h3 class="btitle">🧩 {{ $t('market.clients') }}</h3>
      <div class="cards">
        <div v-for="c in MARKET_CLIENTS" :key="c.id" class="card">
          <div class="cicon">{{ c.icon }}</div>
          <div class="cname">{{ $t(c.labelKey) }}</div>
          <div class="cver">{{ version ? $t('market.version', { version }) : '' }}</div>
          <img v-if="c.qr" class="qr" :src="qrMobile" :alt="$t(c.labelKey)" width="120" height="120" />
          <a class="dl" :href="c.href" target="_blank" rel="noopener">{{ $t('market.download') }}</a>
        </div>
      </div>
    </section>

    <section class="block">
      <h3 class="btitle">📦 {{ $t('market.extensions') }}</h3>
      <div v-if="!files.length" class="empty">{{ $t('market.empty') }}</div>
      <template v-else>
        <ul v-if="groups.skill.length || groups.other.length" class="exts">
          <li v-for="f in [...groups.skill, ...groups.other]" :key="f.name" class="ext">
            <span class="ekind">{{ $t(marketKindKey(f.kind)) }}</span>
            <span class="ename" :title="f.name">{{ f.name }}</span>
            <span class="emeta">{{ fmtSize(f.size) }}</span>
            <span class="emeta">{{ whenLabel(f.updatedAt) }}</span>
            <button v-if="installableOf(f)" class="einstall" :disabled="installing === f.name" @click="install(f.name)">
              {{ installing === f.name ? $t('common.sending') : $t('market.install') }}
            </button>
          </li>
        </ul>
        <div v-else class="empty">{{ $t('market.empty') }}</div>
      </template>
      <div v-if="installMsg" class="hint">{{ installMsg }}</div>
    </section>

    <section class="block">
      <h3 class="btitle">🧰 {{ $t('market.tools') }}</h3>
      <MiniTools />
    </section>

    <footer class="foot">
      <span>🐞 {{ $t('market.feedback') }}</span>
      <a class="link" :href="ISSUES_URL" target="_blank" rel="noopener">{{ ISSUES_URL }}</a>
      <span class="sep">·</span>
      <span>🎬 {{ $t('market.tutorial') }}</span>
      <a class="link" :href="TUTORIAL_URL" target="_blank" rel="noopener">{{ TUTORIAL_URL }}</a>
    </footer>
  </div>
</template>

<style scoped>
.market { padding: 14px; overflow: auto; height: 100%; box-sizing: border-box; color: var(--tx); }
.block { margin: 0 0 18px; }
.btitle { margin: 0 0 10px; color: var(--tx1); font-size: 14px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--bd); border-radius: 10px; padding: 14px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cicon { font-size: 34px; line-height: 1; }
.cname { font-weight: 700; color: var(--tx1); font-size: 13px; text-align: center; }
.cver { color: var(--tx4); font-size: 11px; min-height: 14px; }
.qr { background: #fff; border-radius: 6px; padding: 6px; box-sizing: content-box; }
.dl { color: var(--ac2); font-size: 12px; font-weight: 600; text-decoration: none; }
.dl:hover { text-decoration: underline; }
.exts { list-style: none; margin: 0; padding: 0; }
.ext { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--bd2); font-size: 12px; }
.ekind { flex: none; background: var(--bg4); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; }
.ename { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx2); }
.emeta { flex: none; color: var(--tx4); font-size: 11px; }
.einstall { flex: none; background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 14px; cursor: pointer; font-size: 12px; }
.einstall:disabled { opacity: .55; cursor: default; }
.empty { color: var(--tx4); font-size: 12px; }
.hint { color: var(--tx3); font-size: 12px; margin-top: 6px; }
.notice { margin: 0 0 18px; border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); }
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
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--tx3); font-size: 12px; padding-top: 6px; border-top: 1px solid var(--bd2); }
.foot .link { color: var(--ac2); text-decoration: none; word-break: break-all; }
.foot .link:hover { text-decoration: underline; }
.foot .sep { color: var(--tx5); }
</style>
