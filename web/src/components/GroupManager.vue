<script setup lang="ts">
import { ref } from 'vue';
import { useCodeGroups } from '../codeGroups';
import { t } from '../i18n';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { groups, addGroup, removeGroup, save } = useCodeGroups();
const draft = ref('');
const msg = ref('');

function onAdd() {
  if (!addGroup(draft.value)) { msg.value = t('codestat.groups.dup'); return; }
  draft.value = '';
  msg.value = '';
}

async function onSave() {
  try {
    await save();
    emit('close');
  } catch (e: any) {
    msg.value = t('codestat.groups.save_failed', { msg: e?.message || String(e) });
  }
}
</script>

<template>
  <el-dialog :model-value="open" :title="$t('codestat.groups.title')" width="420px" @close="emit('close')">
    <div class="row">
      <input v-model="draft" class="ginput" :placeholder="$t('codestat.groups.placeholder')" @keyup.enter="onAdd" />
      <button class="btn" @click="onAdd">{{ $t('codestat.groups.add') }}</button>
    </div>
    <ul class="glist">
      <li v-for="g in groups" :key="g">
        <span>{{ g }}</span>
        <button class="rm" @click="removeGroup(g)">✕</button>
      </li>
    </ul>
    <div v-if="!groups.length" class="hint">{{ $t('codestat.groups.empty') }}</div>
    <div v-if="msg" class="err">{{ msg }}</div>
    <template #footer>
      <button class="btn ghost" @click="emit('close')">{{ $t('common.cancel') }}</button>
      <button class="btn primary" @click="onSave">{{ $t('common.ok') }}</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.row { display: flex; gap: 8px; }
.ginput { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 13px; }
.glist { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.glist li { display: flex; align-items: center; justify-content: space-between; background: var(--bg2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; font-size: 13px; color: var(--tx); }
.rm { background: none; border: none; color: var(--tx3); cursor: pointer; }
.rm:hover { color: var(--err); }
.hint { color: var(--tx4); font-size: 12px; margin-top: 8px; }
.err { color: var(--err); font-size: 12px; margin-top: 8px; }
.btn { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover { color: var(--tx1); border-color: var(--ac); }
.btn.primary { background: var(--ac); color: var(--onac); border: none; font-weight: 600; }
.btn.ghost { background: none; }
</style>
