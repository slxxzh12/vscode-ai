<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { NGINX_DEFAULT_PORT } from '@devflow/shared';
import { t } from '../../i18n';
import { useNginx, emptyRule, type NginxRule } from './useNginx';
import StaticSiteCard from './StaticSiteCard.vue';

const api = useNginx();
const draft = ref<{ key: string; rule: NginxRule } | null>(null);
const highlightId = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const sites = computed(() => api.rules.value.filter((r) => !!r.staticDir));

function nextPort(): number {
  const used = new Set(api.rules.value.filter((r) => r.mode === 'port').map((r) => Number(r.listenPort)));
  let port = NGINX_DEFAULT_PORT;
  while (used.has(port)) port += 1;
  return port;
}

function newSite() {
  draft.value = {
    key: `static-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    rule: { ...emptyRule(), name: t('static_site.default_name'), listenPort: nextPort(), spaFallback: true },
  };
}
function onSaved(rule: NginxRule) {
  draft.value = null;
  highlightId.value = rule.id || '';
}
function clearDraft() { draft.value = null; }
function openDemo(ppt = false) {
  window.open('/api/demo-site/' + (ppt ? '?ppt=1' : ''), '_blank', 'noopener');
}

onMounted(async () => {
  const wanted = new URLSearchParams(location.search).get('rule') || '';
  await api.load();
  if (wanted && sites.value.some((r) => r.id === wanted)) highlightId.value = wanted;
  timer = setInterval(() => { void api.load(); }, 2000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="ssbody">
    <section class="ssshowcase">
      <div class="sstitle">{{ $t('static_site.showcase_title') }}</div>
      <div class="ssdesc">{{ $t('static_site.showcase_desc') }}</div>
      <div class="ssfeat">
        <span>{{ $t('static_site.showcase_ppt') }}</span>
        <span>{{ $t('static_site.showcase_table') }}</span>
        <span>{{ $t('static_site.showcase_css') }}</span>
      </div>
      <div class="ssnewrow">
        <button class="ssbtn ssnew" @click="newSite">{{ $t('static_site.new') }}</button>
        <button class="ssbtn" @click="openDemo(false)">{{ $t('static_site.demo_open') }}</button>
        <button class="ssbtn ppt" @click="openDemo(true)">{{ $t('static_site.ppt_demo') }}</button>
      </div>
    </section>

    <StaticSiteCard
      v-if="draft"
      :key="draft.key"
      :rule="draft.rule"
      :api="api"
      draft
      @saved="onSaved"
      @deleted="clearDraft"
    />

    <StaticSiteCard
      v-for="r in sites"
      :key="r.id"
      :rule="r"
      :api="api"
      :status="r.id ? api.status.value[r.id] : null"
      :highlight="highlightId === r.id"
    />

    <div v-if="!sites.length && !draft" class="ssempty">{{ $t('static_site.empty') }}</div>
  </div>
</template>

<style scoped>
.ssbody { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; overflow: auto; padding: 4px 2px; box-sizing: border-box; }
.ssnewrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex: none; }
.ssempty { padding: 12px; opacity: .6; }
.ssbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ssshowcase { flex: none; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg3); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.sstitle { color: var(--tx1); font-weight: 600; }
.ssdesc { color: var(--tx3); font-size: 12px; line-height: 1.5; }
.ssfeat { display: flex; flex-wrap: wrap; gap: 6px; }
.ssfeat span { color: var(--ac2); font-size: 11px; background: rgba(76, 154, 255, .1); border: 1px solid rgba(76, 154, 255, .25); border-radius: 999px; padding: 2px 8px; }
.ssbtn.ppt { border-color: var(--ac2); color: var(--ac2); font-weight: 600; }
</style>
