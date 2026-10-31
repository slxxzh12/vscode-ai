<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../../i18n';
import { encodeB64, decodeB64 } from '../../base64';
import { copyText } from '../../clipboard';
import CodeEditor from '../../components/CodeEditor.vue';

// 独立 Base64 工具：上下两栏（上=原文，下=Base64），编码/解码双向。
const plain = ref('');
const encoded = ref('');
const err = ref('');

function doEncode() {
  err.value = '';
  try { encoded.value = encodeB64(plain.value); }
  catch { encoded.value = ''; err.value = t('tools.b64.invalid'); }
}
function doDecode() {
  err.value = '';
  if (!encoded.value.trim()) { plain.value = ''; return; }
  try { plain.value = decodeB64(encoded.value); }
  catch { err.value = t('tools.b64.invalid'); }
}
function copyPlain() { void copyText(plain.value); }
function copyEncoded() { void copyText(encoded.value); }
function clearAll() { plain.value = ''; encoded.value = ''; err.value = ''; }
</script>

<template>
  <div class="b64tool">
    <div class="acts">
      <button class="btn primary" @click="doEncode">{{ $t('tools.b64.encode') }}</button>
      <button class="btn" @click="doDecode">{{ $t('tools.b64.decode') }}</button>
      <span class="sp" />
      <button class="btn" :disabled="!plain" @click="copyPlain">{{ $t('tools.copy') }}</button>
      <button class="btn" :disabled="!encoded" @click="copyEncoded">{{ $t('tools.copy') }}</button>
      <button class="btn" @click="clearAll">{{ $t('tools.clear') }}</button>
    </div>
    <div class="col">
      <div class="lbl">{{ $t('tools.b64.plain') }}</div>
      <CodeEditor v-model="plain" class="area" :placeholder="$t('tools.b64.plain')" />
    </div>
    <div class="col">
      <div class="lbl">{{ $t('tools.b64.encoded') }}</div>
      <CodeEditor v-model="encoded" class="area" :placeholder="$t('tools.b64.encoded')" />
      <div v-if="err" class="err">{{ err }}</div>
    </div>
  </div>
</template>

<style scoped>
.b64tool { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 8px 10px; gap: 8px; box-sizing: border-box; }
.acts { display: flex; gap: 8px; align-items: center; flex: none; }
.btn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.sp { flex: 1; }
.col { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
.lbl { flex: none; font-size: 11px; font-weight: 600; color: var(--tx2); }
.area { flex: 1; min-height: 0; }
.area :deep(.cm-editor) { height: 100%; }
.err { color: var(--err); font-size: 12px; flex: none; }
</style>
