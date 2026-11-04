<script setup lang="ts">
import type { OpencodeStatus } from '../useOpencodeInstall';

defineProps<{ open: boolean; status: OpencodeStatus | null; installing: boolean }>();
const emit = defineEmits<{ (e: 'install'): void; (e: 'close'): void }>();

function percent(status: OpencodeStatus | null) {
  return Math.max(0, Math.min(100, Number(status?.download?.percent) || 0));
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="oc-mask" @click.self="emit('close')">
      <div class="oc-box" role="dialog" aria-modal="true">
        <div class="oc-head">
          <span class="oc-ico">!</span>
          <span class="oc-title">{{ $t('opencode.install_title') }}</span>
        </div>
        <div class="oc-body">
          <div class="oc-desc">{{ $t('opencode.install_desc') }}</div>
          <div v-if="status?.download?.state === 'downloading'" class="oc-progress">
            <div class="oc-bar"><span :style="{ width: percent(status) + '%' }"></span></div>
            <div class="oc-meta">
              {{ status.download.total ? $t('opencode.downloading', { percent: percent(status) }) : $t('opencode.downloading_unknown') }}
            </div>
          </div>
          <div v-else-if="status?.download?.state === 'done'" class="oc-done">
            <div class="oc-ok">{{ $t('opencode.done', { path: status.download.path || status.target }) }}</div>
            <div class="oc-hint">{{ $t('opencode.done_hint') }}</div>
          </div>
          <div v-else-if="status?.download?.state === 'error'" class="oc-error">
            {{ $t('opencode.failed', { msg: status.download.error }) }}
          </div>
          <div v-else class="oc-hint">{{ $t('opencode.install_hint') }}</div>
        </div>
        <div class="oc-foot">
          <button class="oc-btn" @click="emit('close')">{{ $t('opencode.later') }}</button>
          <button
            v-if="status?.download?.state !== 'done'"
            class="oc-btn oc-primary"
            :disabled="installing || status?.download?.state === 'downloading'"
            @click="emit('install')"
          >
            {{ installing || status?.download?.state === 'downloading' ? $t('opencode.installing') : (status?.download?.state === 'error' ? $t('opencode.retry') : $t('opencode.install_now')) }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.oc-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .58); display: flex; align-items: center; justify-content: center; z-index: 3300; }
.oc-box { width: 500px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .4); padding: 18px 20px 14px; }
.oc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.oc-ico { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: var(--ac); }
.oc-title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.oc-body { display: flex; flex-direction: column; gap: 10px; }
.oc-desc { font-size: 13px; line-height: 1.65; color: var(--tx2); }
.oc-hint { font-size: 12px; line-height: 1.6; color: var(--tx3); word-break: break-all; }
.oc-progress { display: flex; flex-direction: column; gap: 6px; }
.oc-bar { height: 7px; border-radius: 2px; overflow: hidden; background: var(--bg2); border: 1px solid var(--bd); }
.oc-bar span { display: block; height: 100%; background: var(--ac); transition: width .2s ease; }
.oc-meta { font-size: 12px; color: var(--ac2); }
.oc-done { display: flex; flex-direction: column; gap: 4px; }
.oc-ok { font-size: 13px; color: var(--tx1); word-break: break-all; }
.oc-error { font-size: 13px; color: var(--errtx); word-break: break-word; }
.oc-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.oc-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.oc-btn:hover { border-color: var(--ac); color: var(--ac); }
.oc-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.oc-primary:hover { filter: brightness(1.08); color: #fff; }
.oc-btn:disabled { opacity: .6; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
