<script setup lang="ts">
import { watch } from 'vue';
import { MINI_TOOLS, type ToolId } from '../tools/catalog';
import { pendingTool, clearPendingTool, requestToolTab, requestProxyTab } from '../uiIntents';

const TOOLS = MINI_TOOLS;

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  if (id === 'nginx') { requestProxyTab('nginx'); return; }
  requestToolTab(id);
}

watch(pendingTool, (id) => {
  if (!id) return;
  openTool(id);
  clearPendingTool();
}, { immediate: true });
</script>

<template>
  <div class="mt">
    <div class="mtrow">
      <button v-for="x in TOOLS" :key="x.id" class="mticon" :disabled="x.disabled" :title="x.disabled && x.hint ? $t(x.hint) : $t(x.labelKey)" @click="openTool(x.id)">
        <span class="mtglyph">{{ x.icon }}</span><span class="mtname">{{ $t(x.labelKey) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mt { margin: 0 0 16px; }
.mtrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px; }
.mticon { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 16px; padding: 22px 12px; cursor: pointer; font-size: 15px; }
.mticon:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mticon:disabled { opacity: .5; cursor: default; }
.mtglyph { font-size: 40px; line-height: 1; }
.mtname { text-align: center; line-height: 1.3; }
</style>
