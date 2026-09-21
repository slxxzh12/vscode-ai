<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import { encodeB64, decodeB64 } from '../base64';
import { copyText } from '../clipboard';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{ getText: () => string }>();

const encodeOut = ref('');
const decodeInput = ref('');
const decodeOut = ref('');
const decodeErr = ref('');

function refresh() {
  if (!props.getText) { encodeOut.value = ''; return; }
  try {
    encodeOut.value = encodeB64(props.getText());
  } catch {
    encodeOut.value = '';
  }
}

function refreshDecode() {
  const src = decodeInput.value;
  decodeErr.value = '';
  decodeOut.value = '';
  if (!src.trim()) return;
  try {
    decodeOut.value = decodeB64(src);
  } catch {
    decodeErr.value = t('fp.b64_invalid');
  }
}

function reset() {
  encodeOut.value = '';
  decodeInput.value = '';
  decodeOut.value = '';
  decodeErr.value = '';
}

function feedDecodeFromEncode() {
  decodeInput.value = encodeOut.value;   // watch 自动触发解码
}

watch(decodeInput, refreshDecode);
onMounted(() => { refresh(); refreshDecode(); });

defineExpose({ refresh, reset });
</script>

<template>
  <div class="b64panel">
    <div class="b64col">
      <div class="b64ch">
        <span class="b64t">{{ $t('fp.b64.encode') }}</span>
        <div class="b64btns">
          <button class="b64b" :disabled="!encodeOut" @click="copyText(encodeOut)">{{ $t('common.copy') }}</button>
        </div>
      </div>
      <pre class="b64pre">{{ encodeOut }}</pre>
    </div>
    <div class="b64col">
      <div class="b64ch">
        <span class="b64t">{{ $t('fp.b64.decode') }}</span>
        <div class="b64btns">
          <button class="b64b" :disabled="!encodeOut" @click="feedDecodeFromEncode()">{{ $t('fp.b64.encode_to_decode') }}</button>
          <button class="b64b" :disabled="!decodeOut" @click="copyText(decodeOut)">{{ $t('common.copy') }}</button>
          <button class="b64b" :disabled="!decodeInput" @click="decodeInput = ''">{{ $t('fp.b64.clear') }}</button>
        </div>
      </div>
      <CodeEditor v-model="decodeInput" class="b64ta" :placeholder="$t('fp.b64.placeholder')" />
      <div v-if="decodeErr" class="b64err">{{ decodeErr }}</div>
      <pre v-else class="b64pre">{{ decodeOut }}</pre>
    </div>
  </div>
</template>

<style scoped>
.b64panel { flex: none; display: flex; gap: 8px; height: 220px; padding: 8px 10px; border-top: 1px solid var(--bd); background: var(--bg2); box-sizing: border-box; }
.b64col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; padding: 6px; }
.b64ch { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; }
.b64t { font-size: 11px; font-weight: 600; color: var(--tx2); white-space: nowrap; }
.b64btns { display: flex; gap: 6px; flex: none; }
.b64b { background: transparent; border: 1px solid var(--bd); color: var(--tx2); font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.b64b:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.b64b:disabled { opacity: .45; cursor: default; }
.b64pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 6px 8px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--tx); box-sizing: border-box; }
.b64ta { width: 100%; box-sizing: border-box; flex: none; --cm-min: 72px; }
.b64err { color: var(--err); font-size: 12px; flex: none; }
</style>
