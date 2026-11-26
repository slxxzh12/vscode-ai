<script setup lang="ts">
import { ref, watch } from 'vue';
import NginxTool from '../tools/nginx/NginxTool.vue';
import StaticSitesView from '../tools/nginx/StaticSitesView.vue';
import AiSiteView from '../tools/ai-site/AiSiteView.vue';
import LlmProxyView from './ProxyView.vue';
import { pendingProxyTab, clearPendingProxyTab, type ProxyTab } from '../uiIntents';

const KEY = 'devflow-proxy-tab';
function loadTab(): ProxyTab {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === 'ai' || v === 'nginx' || v === 'static' || v === 'llm') return v;
  } catch { /* ignore */ }
  return 'ai';
}
const tab = ref<ProxyTab>(loadTab());

function setTab(v: ProxyTab) {
  tab.value = v;
  try { sessionStorage.setItem(KEY, v); } catch { /* ignore */ }
}

watch(pendingProxyTab, (v) => {
  if (!v) return;
  setTab(v);
  clearPendingProxyTab();
}, { immediate: true });
</script>

<template>
  <div class="hub">
    <el-tabs :model-value="tab" class="hubtabs" @tab-change="(n: string | number) => setTab(n as ProxyTab)">
      <el-tab-pane :label="$t('proxy.tabs.ai')" name="ai"><AiSiteView /></el-tab-pane>
      <el-tab-pane :label="$t('proxy.tabs.static')" name="static"><StaticSitesView /></el-tab-pane>
      <el-tab-pane :label="$t('proxy.tabs.nginx')" name="nginx"><NginxTool /></el-tab-pane>
      <el-tab-pane :label="$t('proxy.tabs.llm')" name="llm"><LlmProxyView /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hubtabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.hubtabs :deep(.el-tabs__header) { margin: 0; padding: 4px 10px 0; flex: none; }
.hubtabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: hidden; }
.hubtabs :deep(.el-tab-pane) { height: 100%; }
</style>
