<script setup lang="ts">
defineProps<{ open: boolean; current: string; latest: string }>();
const emit = defineEmits<{ (e: 'go'): void; (e: 'close'): void; (e: 'skip'): void }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="ep-mask" @click.self="emit('close')">
      <div class="ep-box" role="dialog" aria-modal="true">
        <div class="ep-head"><span class="ep-ico">↑</span><span class="ep-title">{{ $t('upgrade.title') }}</span></div>
        <div class="ep-body">
          <div class="urow"><span class="uk">{{ $t('upgrade.current') }}</span><span class="uv">{{ current || '-' }}</span></div>
          <div class="urow"><span class="uk">{{ $t('upgrade.latest') }}</span><span class="uv">{{ latest || '-' }}</span></div>
        </div>
        <div class="ep-foot">
          <button class="ep-btn upg-skip" @click="emit('skip')">{{ $t('upgrade.skip') }}</button>
          <button class="ep-btn upg-close" @click="emit('close')">{{ $t('upgrade.later') }}</button>
          <button class="ep-btn ep-primary upg-go" @click="emit('go')">{{ $t('upgrade.go') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.ep-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3100; }
.ep-box { width: 420px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.ep-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ep-ico { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: var(--ac); }
.ep-title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.ep-body { display: flex; flex-direction: column; gap: 6px; }
.urow { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.uk { color: var(--tx3); width: 84px; flex: none; }
.uv { color: var(--tx1); font-family: ui-monospace, Consolas, monospace; }
.ep-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.ep-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.ep-btn:hover { border-color: var(--ac); color: var(--ac); }
.ep-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.ep-primary:hover { filter: brightness(1.08); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
