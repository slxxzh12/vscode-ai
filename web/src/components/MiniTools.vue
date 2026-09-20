<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../i18n';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import NavicatTool from '../tools/navicat/NavicatTool.vue';
import NotepadTool from '../tools/notepad/NotepadTool.vue';
import TextToolBody from '../tools/text/TextToolBody.vue';
import { MINI_TOOLS, type ToolId } from '../tools/catalog';
import { pendingTool, clearPendingTool } from '../uiIntents';

const TOOLS = MINI_TOOLS;

const open = ref<ToolId | null>(null);
const dlgOpen = computed({ get: () => open.value !== null, set: (v: boolean) => { if (!v) open.value = null; } });

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
}

function titleOf(id: ToolId) { return t(TOOLS.find((x) => x.id === id)?.labelKey || 'tools.title'); }

// 从欢迎页跳转过来时：自动打开待办工具，然后清空意图
watch(pendingTool, (id) => {
  if (!id) return;
  openTool(id);
  clearPendingTool();
}, { immediate: true });

const textTool = computed<'yaml' | 'js' | 'translate'>(() =>
  open.value === 'yaml' || open.value === 'js' || open.value === 'translate' ? open.value : 'translate');
</script>

<template>
  <div class="mt">
    <div class="mtrow">
      <button v-for="x in TOOLS" :key="x.id" class="mticon" :class="{ on: open === x.id }" :disabled="x.disabled" :title="x.disabled && x.hint ? $t(x.hint) : $t(x.labelKey)" @click="openTool(x.id)">
        <span class="mtglyph">{{ x.icon }}</span><span class="mtname">{{ $t(x.labelKey) }}</span>
      </button>
    </div>

    <el-dialog v-model="dlgOpen" :title="open ? titleOf(open) : ''" fullscreen append-to-body class="mtdlg">
      <PostmanTool v-if="open === 'postman'" />
      <NavicatTool v-else-if="open === 'navicat'" />
      <NotepadTool v-else-if="open === 'notepad'" />
      <TextToolBody v-else-if="open === 'yaml' || open === 'js' || open === 'translate'" :key="textTool" :tool="textTool" />
    </el-dialog>
  </div>
</template>

<style scoped>
.mt { margin: 0 0 16px; }
.mtrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px; }
.mticon { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 16px; padding: 22px 12px; cursor: pointer; font-size: 15px; }
.mticon:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mticon.on { border-color: var(--ac); color: var(--ac2); }
.mticon:disabled { opacity: .5; cursor: default; }
.mtglyph { font-size: 40px; line-height: 1; }
.mtname { text-align: center; line-height: 1.3; }
</style>
