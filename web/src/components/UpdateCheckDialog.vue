<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  open: boolean;
  current: string;
  latest: string;
  url: string;
  hasUpdate: boolean;
  checking: boolean;
  error: string;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'open-releases'): void }>();

const statusClass = computed(() => ({
  checking: props.checking,
  new: !props.checking && !props.error && props.hasUpdate,
  err: !props.checking && !!props.error,
  ok: !props.checking && !props.error && !props.hasUpdate,
}));
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="uc-mask" @click.self="emit('close')">
      <div class="uc-box" role="dialog" aria-modal="true">
        <div class="uc-head">
          <span class="uc-title">{{ $t('upgrade.check') }}</span>
          <button class="uc-x" @click="emit('close')">×</button>
        </div>
        <div class="uc-body">
          <div class="urow"><span class="uk">{{ $t('upgrade.current') }}</span><span class="uv">{{ current || '-' }}</span></div>
          <div class="urow"><span class="uk">{{ $t('upgrade.latest') }}</span><span class="uv">{{ latest || '-' }}</span></div>
          <div class="urow"><span class="uk">{{ $t('upgrade.releases_page') }}</span><a class="uv ulink" :href="url" target="_blank" rel="noopener">{{ url }}</a></div>
          <div class="ustatus" :class="statusClass">
            <template v-if="checking">{{ $t('upgrade.checking') }}</template>
            <template v-else-if="error">{{ $t('upgrade.failed_detail', { msg: error }) }}</template>
            <template v-else-if="hasUpdate">{{ $t('upgrade.new_found', { v: latest }) }}</template>
            <template v-else>{{ $t('upgrade.up_to_date') }}</template>
          </div>
        </div>
        <div class="uc-foot">
          <button class="uc-btn" @click="emit('close')">{{ $t('upgrade.later') }}</button>
          <button class="uc-btn primary" @click="emit('open-releases')">{{ $t('upgrade.open_releases') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.uc-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3100; }
.uc-box { width: 460px; max-width: 92vw; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 16px 20px 14px; }
.uc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.uc-title { font-size: 15px; font-weight: 600; }
.uc-x { background: none; border: none; color: var(--tx3); font-size: 18px; cursor: pointer; }
.uc-body { display: flex; flex-direction: column; gap: 8px; }
.urow { display: flex; align-items: baseline; gap: 10px; font-size: 13px; }
.uk { color: var(--tx3); width: 92px; flex: none; }
.uv { color: var(--tx1); font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.ulink { color: var(--ac2); text-decoration: none; }
.ulink:hover { text-decoration: underline; }
.ustatus { margin-top: 4px; padding: 7px 10px; border-radius: 6px; font-size: 12px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); }
.ustatus.ok { color: #2ecc71; border-color: color-mix(in srgb, #2ecc71 45%, transparent); }
.ustatus.new { color: var(--ac2); border-color: color-mix(in srgb, var(--ac2) 45%, transparent); }
.ustatus.err { color: var(--err); border-color: var(--err); }
.uc-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.uc-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.uc-btn:hover { border-color: var(--ac2); color: var(--ac2); }
.uc-btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.uc-btn.primary:hover { filter: brightness(1.08); color: var(--onac); }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
