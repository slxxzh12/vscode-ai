<script setup lang="ts">
import { onMounted, ref } from 'vue';
import NginxTool from '../tools/nginx/NginxTool.vue';
import LlmProxyView from './ProxyView.vue';

type ProxyTab = 'nginx' | 'llm';
const KEY = 'devflow-proxy-tab';
const tab = ref<ProxyTab>('nginx');

onMounted(() => {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === 'nginx' || v === 'llm') tab.value = v;
  } catch { /* ignore */ }
});

function setTab(v: ProxyTab) {
  tab.value = v;
  try { sessionStorage.setItem(KEY, v); } catch { /* ignore */ }
}
</script>

<template>
  <div class="hub">
    <header class="hubbar">
      <button class="hubtab" :class="{ on: tab === 'nginx' }" @click="setTab('nginx')">{{ $t('proxy.tabs.nginx') }}</button>
      <button class="hubtab" :class="{ on: tab === 'llm' }" @click="setTab('llm')">{{ $t('proxy.tabs.llm') }}</button>
    </header>
    <div class="hubbody">
      <NginxTool v-show="tab === 'nginx'" />
      <LlmProxyView v-show="tab === 'llm'" />
    </div>
  </div>
</template>

<style scoped>
.hub { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hubbar { display: flex; gap: 4px; padding: 6px 10px 0; border-bottom: 1px solid var(--bd); flex: none; }
.hubtab { background: none; border: none; color: var(--tx2); padding: 7px 14px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 13px; }
.hubtab:hover { color: var(--ac2); }
.hubtab.on { color: var(--ac2); border-bottom-color: var(--ac2); }
.hubbody { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.hubbody > * { flex: 1; min-height: 0; }
</style>
