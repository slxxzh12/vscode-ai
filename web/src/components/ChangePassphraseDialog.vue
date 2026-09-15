<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '../i18n';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'confirm', v: { oldPass: string; newPass: string }): void;
  (e: 'cancel'): void;
}>();

const oldPass = ref('');
const newPass = ref('');
const confirmPass = ref('');
const error = ref('');

watch(() => props.open, (v) => {
  if (v) { oldPass.value = ''; newPass.value = ''; confirmPass.value = ''; error.value = ''; }
});

function submit() {
  if (!oldPass.value || !newPass.value) { error.value = t('llm.vault.pass_required'); return; }
  if (newPass.value !== confirmPass.value) { error.value = t('llm.vault.pass_mismatch'); return; }
  emit('confirm', { oldPass: oldPass.value, newPass: newPass.value });
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('cancel')">
      <div class="box" role="dialog" aria-modal="true">
        <div class="head"><span class="ico">🔑</span><span class="title">{{ $t('llm.vault.change') }}</span></div>
        <div class="hint">{{ $t('llm.vault.change_hint') }}</div>
        <label class="fld"><span>{{ $t('llm.vault.old') }}</span><input v-model="oldPass" type="password" autocomplete="off" /></label>
        <label class="fld"><span>{{ $t('llm.vault.new') }}</span><input v-model="newPass" type="password" autocomplete="off" /></label>
        <label class="fld"><span>{{ $t('llm.vault.confirm_new') }}</span><input v-model="confirmPass" type="password" autocomplete="off" @keyup.enter="submit" /></label>
        <div v-if="error" class="err">{{ error }}</div>
        <div class="foot">
          <button class="btn" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
          <button class="btn primary" @click="submit">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 400px; max-width: 90vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ico { font-size: 16px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.hint { font-size: 12px; line-height: 1.6; color: var(--tx3); margin-bottom: 14px; }
.fld { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; color: var(--tx2); }
.fld span { width: 88px; flex: none; }
.fld input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 6px 9px; box-sizing: border-box; }
.err { color: #f56c6c; font-size: 12px; margin: 4px 0 0 98px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn:hover { border-color: var(--ac); color: var(--ac); }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
