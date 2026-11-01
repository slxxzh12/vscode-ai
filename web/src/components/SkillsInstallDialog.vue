<script setup lang="ts">
import type { SkillTargetStatus } from '../useSkillsInstall';

defineProps<{ open: boolean; targets: SkillTargetStatus[]; installing: boolean }>();
const emit = defineEmits<{ (e: 'install'): void; (e: 'close'): void }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="sk-mask" @click.self="emit('close')">
      <div class="sk-box" role="dialog" aria-modal="true">
        <div class="sk-head"><span class="sk-ico">◇</span><span class="sk-title">{{ $t('skills.install_title') }}</span></div>
        <div class="sk-body">
          <div class="sk-desc">{{ $t('skills.install_desc') }}</div>
          <div v-for="t in targets" :key="t.id" class="sk-row">
            <span class="sk-name">{{ t.label }}</span>
            <span class="sk-count">{{ $t('skills.missing_count', { count: t.missing.length }) }}</span>
            <span class="sk-dir" :title="t.dir">{{ t.dir }}</span>
          </div>
        </div>
        <div class="sk-foot">
          <button class="sk-btn" @click="emit('close')">{{ $t('skills.later') }}</button>
          <button class="sk-btn sk-primary" :disabled="installing" @click="emit('install')">
            {{ installing ? $t('skills.installing') : $t('skills.install_now') }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.sk-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3100; }
.sk-box { width: 460px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.sk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.sk-ico { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--ac); }
.sk-title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.sk-body { display: flex; flex-direction: column; gap: 8px; }
.sk-desc { font-size: 13px; color: var(--tx2); }
.sk-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.sk-name { color: var(--tx1); flex: none; font-weight: 600; }
.sk-count { color: var(--ac2); flex: none; }
.sk-dir { color: var(--tx3); font-family: ui-monospace, Consolas, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.sk-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.sk-btn:hover { border-color: var(--ac); color: var(--ac); }
.sk-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.sk-primary:hover { filter: brightness(1.08); color: #fff; }
.sk-btn:disabled { opacity: .6; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
