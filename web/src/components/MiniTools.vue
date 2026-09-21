<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { t } from '../i18n';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import NavicatTool from '../tools/navicat/NavicatTool.vue';
import NotepadTool from '../tools/notepad/NotepadTool.vue';
import TextToolBody from '../tools/text/TextToolBody.vue';
import { MINI_TOOLS, type ToolId } from '../tools/catalog';
import { DIALOG_ACTIONS_ID, DIALOG_ACTIONS_TARGET } from '../tools/dialogActions';
import { pendingTool, clearPendingTool, requestToolTab } from '../uiIntents';

const TOOLS = MINI_TOOLS;

// 工具的操作按钮在各自组件里，通过 Teleport 挂到标题行右侧的操作区
provide(DIALOG_ACTIONS_TARGET, `#${DIALOG_ACTIONS_ID}`);

const open = ref<ToolId | null>(null);
const dlgOpen = computed({ get: () => open.value !== null, set: (v: boolean) => { if (!v) open.value = null; } });

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  // 记事本 / YAML：改为在主区以「工具页签」打开（不再弹窗）
  if (id === 'notepad' || id === 'yaml') { requestToolTab(id); return; }
  open.value = id;
}

function titleOf(id: ToolId) { return t(TOOLS.find((x) => x.id === id)?.labelKey || 'tools.title'); }

// 从欢迎页跳转过来时：自动打开待办工具，然后清空意图
watch(pendingTool, (id) => {
  if (!id) return;
  openTool(id);
  clearPendingTool();
}, { immediate: true });

const textTool = computed<'yaml' | 'translate'>(() =>
  open.value === 'yaml' || open.value === 'translate' ? open.value : 'translate');
</script>

<template>
  <div class="mt">
    <div class="mtrow">
      <button v-for="x in TOOLS" :key="x.id" class="mticon" :class="{ on: open === x.id }" :disabled="x.disabled" :title="x.disabled && x.hint ? $t(x.hint) : $t(x.labelKey)" @click="openTool(x.id)">
        <span class="mtglyph">{{ x.icon }}</span><span class="mtname">{{ $t(x.labelKey) }}</span>
      </button>
    </div>

    <el-dialog v-model="dlgOpen" fullscreen append-to-body class="mtdlg">
      <template #header>
        <div class="mtdlg-head">
          <span class="mtdlg-title">{{ open ? titleOf(open) : '' }}</span>
          <div :id="DIALOG_ACTIONS_ID" class="mtdlg-actions"></div>
        </div>
      </template>
      <PostmanTool v-if="open === 'postman'" />
      <NavicatTool v-else-if="open === 'navicat'" />
      <NotepadTool v-else-if="open === 'notepad'" />
      <TextToolBody v-else-if="open === 'yaml' || open === 'translate'" :key="textTool" :tool="textTool" />
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

/* 弹窗标题行：左工具名，右操作按钮（各工具 Teleport 进来），与标题同一行 */
.mtdlg-head { display: flex; align-items: center; gap: 12px; }
.mtdlg-title { flex: none; color: var(--tx1); font-size: 16px; font-weight: 700; }
.mtdlg-actions { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; }
.mtdlg-actions :deep(.npbar),
.mtdlg-actions :deep(.mtacts),
.mtdlg-actions :deep(.pmactsbar),
.mtdlg-actions :deep(.nvtoolbar) { flex: 1; min-width: 0; flex-wrap: nowrap; }
.mtdlg-actions :deep(.pmactsbar),
.mtdlg-actions :deep(.nvtoolbar) { justify-content: flex-end; }
/* 连接名/库名留在左侧，按钮组推到最右 */
.mtdlg-actions :deep(.nvtoolbar) button:first-of-type { margin-left: auto; }
</style>
