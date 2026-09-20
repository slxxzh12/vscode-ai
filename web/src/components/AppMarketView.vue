<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { locale, t } from '../i18n';
import { renderRemoteMarkdown } from '../markdown';
import MiniTools from './MiniTools.vue';
import { useCollab } from '../collaboration/useCollab';
import { useVersion } from '../useVersion';
import {
  ISSUES_URL, MARKET_CLIENTS, TUTORIAL_URL,
  fmtSize, groupClients, groupDownloadFiles, installableOf, marketKindKey, type DownloadFile,
} from '../marketApps';

const base = import.meta.env.BASE_URL;
const qrMobile = `${base}mobile/qr-mobile.svg`;
const clientGroups = groupClients(MARKET_CLIENTS);

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
    <div class="col col-side">
      <section class="notice">
        <h3 class="ntitle">📢 {{ $t('market.notice') }}</h3>
        <div v-if="noticeHtml" class="nbody" v-html="noticeHtml"></div>
        <div v-else class="hint">{{ noticeEmpty || $t('market.notice_empty') }}</div>
      </section>

      <section class="panel">
        <h3 class="btitle">🧩 {{ $t('market.clients') }}</h3>
        <div v-for="g in clientGroups" :key="g.key" class="cgroup">
          <h4 class="gtitle">{{ $t(`market.client.${g.key}`) }}</h4>
          <div class="cards">
            <div v-for="c in g.clients" :key="c.id" class="card" :class="{ soon: c.comingSoon }">
              <div class="cicon">
                <svg v-if="c.brand === 'apple'" class="brand" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>
                <template v-else>{{ c.icon }}</template>
              </div>
              <div class="cname">{{ $t(c.labelKey) }}</div>
              <div class="cver">{{ !c.comingSoon && version ? $t('market.version', { version }) : '' }}</div>
              <img v-if="c.qr && !c.comingSoon" class="qr" :src="qrMobile" :alt="$t(c.labelKey)" width="120" height="120" />
              <span v-if="c.comingSoon" class="soon">{{ $t('market.coming_soon') }}</span>
              <a v-else class="dl" :href="c.href" target="_blank" rel="noopener">{{ $t('market.download') }}</a>
            </div>
          </div>
        </div>
      </section>

      <footer class="foot">
        <span>🐞 {{ $t('market.feedback') }}</span>
        <a class="link" :href="ISSUES_URL" target="_blank" rel="noopener">{{ ISSUES_URL }}</a>
        <span class="sep">·</span>
        <span>🎬 {{ $t('market.tutorial') }}</span>
        <a class="link" :href="TUTORIAL_URL" target="_blank" rel="noopener">{{ TUTORIAL_URL }}</a>
      </footer>
    </div>

    <div class="col col-main">
      <section class="block tools-block">
        <h3 class="btitle">🛠️ {{ $t('market.tools') }}</h3>
        <MiniTools />
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
    </div>
  </div>
</template>

<style scoped>
.market { padding: 14px; height: 100%; box-sizing: border-box; color: var(--tx); display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 16px; overflow: hidden; }
.col { display: flex; flex-direction: column; gap: 18px; min-height: 0; overflow: auto; }
.block { margin: 0; }
.btitle { margin: 0 0 10px; color: var(--tx1); font-size: 14px; }
.cgroup { margin: 0 0 12px; }
.cgroup:last-child { margin: 0; }
.gtitle { margin: 0 0 8px; color: var(--tx3); font-size: 12px; font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--bd); border-radius: 10px; padding: 14px; background: var(--bg2); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cicon { font-size: 34px; line-height: 1; }
.brand { display: block; color: var(--tx1); }
.cname { font-weight: 700; color: var(--tx1); font-size: 13px; text-align: center; line-height: 1.3; min-height: 2.6em; display: flex; align-items: center; justify-content: center; }
.cver { color: var(--tx4); font-size: 11px; min-height: 14px; }
.qr { background: #fff; border-radius: 6px; padding: 6px; box-sizing: content-box; }
.dl { color: var(--ac2); font-size: 12px; font-weight: 600; text-decoration: none; }
.dl:hover { text-decoration: underline; }
.card.soon .cicon { filter: grayscale(1); opacity: .45; }
.soon { color: var(--tx4); font-size: 12px; font-weight: 600; }
.exts { list-style: none; margin: 0; padding: 0; }
.ext { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--bd2); font-size: 12px; }
.ekind { flex: none; background: var(--bg4); color: var(--tx3); border-radius: 4px; padding: 1px 8px; font-size: 11px; }
.ename { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx2); }
.emeta { flex: none; color: var(--tx4); font-size: 11px; }
.einstall { flex: none; background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 14px; cursor: pointer; font-size: 12px; }
.einstall:disabled { opacity: .55; cursor: default; }
.empty { color: var(--tx4); font-size: 12px; }
.hint { color: var(--tx3); font-size: 12px; margin-top: 6px; }
.notice { margin: 0; border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); }
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
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--tx3); font-size: 12px; padding-top: 6px; border-top: 1px solid var(--bd2); margin-top: auto; }
.foot .link { color: var(--ac2); text-decoration: none; word-break: break-all; }
.foot .link:hover { text-decoration: underline; }
.foot .sep { color: var(--tx5); }
/* 主栏（小工具 / 扩展）在左，侧栏（消息 / 下载客户端）在右 */
.col-main { order: 1; }
.col-side { order: 2; gap: 12px; }
.panel { border: 1px solid var(--bd); border-radius: 10px; padding: 12px; background: var(--bg2); }
/* 小工具：加边框底色与更大标题，作为应用市场的主入口 */
.tools-block { border: 1px solid var(--ac2); border-radius: 14px; padding: 14px 16px; background: color-mix(in srgb, var(--ac2) 7%, var(--bg2)); }
.tools-block .btitle { font-size: 17px; margin-bottom: 14px; }
@media (max-width: 760px) {
  .market { grid-template-columns: 1fr; overflow: auto; }
  .col { overflow: visible; }
}
</style>
