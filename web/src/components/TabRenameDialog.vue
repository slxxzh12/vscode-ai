<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';

const props = defineProps<{
  name: string;
  description: string;
  placeholder: string;
}>();

const emit = defineEmits<{
  confirm: [payload: { name: string; description: string }];
  cancel: [];
}>();

const name = ref(props.name);
const desc = ref(props.description);
const nameEl = ref<HTMLInputElement | null>(null);

function onConfirm() {
  emit('confirm', { name: name.value.trim(), description: desc.value.trim() });
}

onMounted(() => {
  void nextTick(() => { nameEl.value?.focus(); nameEl.value?.select(); });
});
</script>

<template>
  <div class="tabdlg-mask" @click.self="emit('cancel')">
    <div class="tabdlg" role="dialog" aria-modal="true">
      <header class="tabdlg-head">{{ $t('term.tab_dialog_title') }}</header>
      <label class="tabdlg-row">
        <span class="tabdlg-label">{{ $t('term.tab_dialog_name') }}</span>
        <input
          ref="nameEl"
          v-model="name"
          class="tabdlg-input"
          :placeholder="placeholder"
          @keyup.enter="onConfirm"
          @keyup.esc="emit('cancel')"
        />
      </label>
      <label class="tabdlg-row">
        <span class="tabdlg-label">{{ $t('term.tab_dialog_desc') }}</span>
        <textarea
          v-model="desc"
          class="tabdlg-area"
          :placeholder="$t('term.tab_dialog_desc_ph')"
          @keyup.esc="emit('cancel')"
        />
      </label>
      <footer class="tabdlg-foot">
        <button type="button" class="tabdlg-btn" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
        <button type="button" class="tabdlg-btn primary" @click="onConfirm">{{ $t('common.ok') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tabdlg-mask { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
.tabdlg { width: min(520px, 92vw); background: var(--bg1); border: 1px solid var(--bd); border-radius: 10px; box-shadow: 0 16px 48px rgba(0,0,0,.45); color: var(--tx1); display: flex; flex-direction: column; gap: 12px; padding: 16px 18px 14px; }
.tabdlg-head { font-size: 14px; font-weight: 700; }
.tabdlg-row { display: flex; flex-direction: column; gap: 6px; }
.tabdlg-label { font-size: 12px; color: var(--tx3); }
.tabdlg-input, .tabdlg-area { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx1); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; }
.tabdlg-input:focus, .tabdlg-area:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.tabdlg-area { min-height: 96px; resize: vertical; line-height: 1.6; }
.tabdlg-foot { display: flex; justify-content: flex-end; gap: 8px; }
.tabdlg-btn { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx2); border-radius: 8px; padding: 5px 16px; cursor: pointer; font-size: 13px; }
.tabdlg-btn:hover { border-color: var(--ac2); color: var(--ac2); }
.tabdlg-btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
</style>
