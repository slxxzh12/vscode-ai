<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  files: { name: string; kind: string; size: number }[];
  version: string;
}>();
const emit = defineEmits<{
  (e: 'confirm', names: string[]): void;
  (e: 'cancel'): void;
  (e: 'install', name: string): void;
}>();

const selected = ref<Record<string, boolean>>({});
watch(() => props.open, (v) => { if (v) selected.value = {}; });

function setAll(v: boolean) { for (const f of props.files) selected.value[f.name] = v; }
function confirm() { emit('confirm', Object.keys(selected.value).filter((k) => selected.value[k])); }
function fmtSize(n: number) {
  if (n == null) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('cancel')">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.downloads.title') }}</div>
        <div class="meta">{{ $t('collab.update.version', { version: version || '—' }) }}</div>
        <div class="row">
          <button class="ghost" @click="setAll(true)">{{ $t('collab.update.select_all') }}</button>
          <button class="ghost" @click="setAll(false)">{{ $t('collab.update.select_none') }}</button>
        </div>
        <div class="list">
          <div v-if="files.length === 0" class="empty">{{ $t('collab.downloads.empty') }}</div>
          <div v-for="f in files" :key="f.name" class="rowline">
            <input type="checkbox" v-model="selected[f.name]" />
            <span class="n">{{ f.name }}</span>
            <span class="s">{{ fmtSize(f.size) }}</span>
            <button v-if="f.kind === 'skill'" class="ghost" @click="emit('install', f.name)">{{ $t('collab.downloads.install') }}</button>
          </div>
        </div>
        <div class="foot">
          <button class="btn" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
          <button class="btn primary" @click="confirm">{{ $t('collab.update.save_seed') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 460px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.list { max-height: 260px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; }
.empty { color: var(--tx6); font-size: 12px; padding: 8px 10px; }
.rowline { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx); }
.rowline:last-child { border-bottom: none; }
.rowline .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowline .s { color: var(--tx6); font-size: 11px; flex: none; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.row { display: flex; gap: 6px; margin-bottom: 8px; }
button.ghost { background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-family: inherit; font-size: 12px; }
</style>
