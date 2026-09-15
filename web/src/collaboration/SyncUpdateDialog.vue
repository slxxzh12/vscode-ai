<script setup lang="ts">
defineProps<{
  open: boolean;
  masterLabel: string;
  version: string;
  files: { name: string; size?: number }[];
  result: string | null;
}>();
const emit = defineEmits<{ (e: 'accept'): void; (e: 'reject'): void }>();
function fmtSize(n?: number) {
  if (n == null) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('reject')">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.update.available', { version }) }}</div>
        <div class="meta">{{ $t('collab.update.from') }}: {{ masterLabel }}</div>
        <div class="list">
          <div v-for="f in files" :key="f.name" class="row">
            <span class="n">{{ f.name }}</span><span class="s">{{ fmtSize(f.size) }}</span>
          </div>
        </div>
        <div v-if="result" class="ok">{{ result }}</div>
        <div class="foot">
          <template v-if="!result">
            <button class="btn" @click="emit('reject')">{{ $t('collab.update.reject') }}</button>
            <button class="btn primary" @click="emit('accept')">{{ $t('collab.update.accept') }}</button>
          </template>
          <button v-else class="btn primary" @click="emit('reject')">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 440px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.list { max-height: 240px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx); }
.row:last-child { border-bottom: none; }
.row .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .s { color: var(--tx6); font-size: 11px; flex: none; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
