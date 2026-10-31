<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'danger';
  requireText?: string;
  placeholder?: string;
}>(), {
  confirmText: 'OK',
  cancelText: 'Cancel',
  type: 'warning',
  requireText: '',
  placeholder: '',
});

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

const typed = ref('');
watch(() => props.open, (v) => { if (v) typed.value = ''; });

const ok = computed(() => !props.requireText || typed.value.trim().toUpperCase() === props.requireText.toUpperCase());
function confirm() { if (ok.value) emit('confirm'); }
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="ep-mask" @click.self="emit('cancel')">
      <div class="ep-box" role="dialog" aria-modal="true">
        <div class="ep-head">
          <span class="ep-ico" :class="type">{{ type === 'danger' ? '✕' : '!' }}</span>
          <span class="ep-title">{{ title }}</span>
        </div>
        <div class="ep-body">{{ message }}</div>
        <div v-if="requireText" class="ep-type">
          <code class="ep-req">{{ requireText }}</code>
          <input
            v-model="typed"
            class="ep-input"
            :class="{ bad: !!typed && !ok }"
            :placeholder="placeholder || requireText"
            autocomplete="off"
            @keyup.enter="confirm"
          />
        </div>
        <div class="ep-foot">
          <button class="ep-btn" @click="emit('cancel')">{{ cancelText }}</button>
          <button class="ep-btn ep-primary" :class="type" :disabled="!ok" @click="confirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.ep-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.ep-box { width: 420px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.ep-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ep-ico { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: #e6a23c; }
.ep-ico.danger { background: #f56c6c; }
.ep-title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.ep-body { font-size: 13px; line-height: 1.65; color: var(--tx2); white-space: pre-wrap; }
.ep-type { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.ep-req { flex: none; color: #f56c6c; font-weight: 700; font-size: 13px; font-family: ui-monospace, Consolas, monospace; background: rgba(245, 108, 108, .12); border: 1px solid rgba(245, 108, 108, .4); border-radius: 4px; padding: 4px 8px; }
.ep-input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 6px 9px; box-sizing: border-box; font-family: inherit; }
.ep-input.bad { border-color: #f56c6c; }
.ep-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.ep-btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.ep-btn:hover { border-color: var(--ac); color: var(--ac); }
.ep-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.ep-primary:hover { filter: brightness(1.08); color: #fff; }
.ep-primary.danger { background: #f56c6c; border-color: #f56c6c; }
.ep-btn:disabled { opacity: .5; cursor: not-allowed; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
