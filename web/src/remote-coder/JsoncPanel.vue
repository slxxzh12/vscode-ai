<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { appendMessages, fetchRemoteInfo } from './useRemoteCoder';
import { t } from '../i18n';

const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const status = ref('');
const path = ref('');
const copied = ref('');

const EXAMPLES = [
  '{ "kind": "message", "text": "hello" }',
  '{ "kind": "screenshot" }',
  '{ "kind": "deliver" }',
];
const EXAMPLE_KEYS = ['remote.jsonc_ex_message', 'remote.jsonc_ex_screenshot', 'remote.jsonc_ex_deliver'];
const FIELDS = [
  { name: 'id', desc: 'remote.jsonc_field_id' },
  { name: 'ts', desc: 'remote.jsonc_field_ts' },
  { name: 'kind', desc: 'remote.jsonc_field_kind' },
  { name: 'text', desc: 'remote.jsonc_field_text' },
  { name: 'handled', desc: 'remote.jsonc_field_handled' },
];

onMounted(async () => {
  const info = await fetchRemoteInfo();
  path.value = info.messagesFile;
});

async function copy(value: string, which: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = which;
    setTimeout(() => { if (copied.value === which) copied.value = ''; }, 1500);
  } catch { /* 剪贴板不可用时忽略 */ }
}

async function submit() {
  status.value = '';
  try {
    const r = await appendMessages(text.value);
    text.value = '';
    status.value = t('remote.jsonc_added', { n: r.added });
  } catch (e) {
    status.value = t('remote.jsonc_failed', { msg: (e as Error).message || String(e) });
  }
}
</script>

<template>
  <div class="jp">
    <header class="jp-head">
      <span class="jp-ttl">{{ $t('remote.jsonc_title') }}</span>
      <button class="jp-close" @click="emit('close')">{{ $t('remote.jsonc_close') }}</button>
    </header>
    <div class="jp-body">
      <section class="jp-sec">
        <h3 class="jp-h">{{ $t('remote.jsonc_format') }}</h3>
        <div v-for="(ex, i) in EXAMPLES" :key="i" class="jp-ex">
          <span class="jp-exlabel">{{ $t(EXAMPLE_KEYS[i]) }}</span>
          <code class="jp-code">{{ ex }}</code>
          <button class="jp-copy" @click="copy(ex, 'ex' + i)">
            {{ copied === 'ex' + i ? $t('remote.jsonc_copied') : $t('remote.jsonc_copy') }}
          </button>
        </div>
        <table class="jp-fields">
          <tbody>
            <tr v-for="f in FIELDS" :key="f.name">
              <td class="jp-fname">{{ f.name }}</td>
              <td class="jp-fdesc">{{ $t(f.desc) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="jp-sec">
        <h3 class="jp-h">{{ $t('remote.jsonc_path') }}</h3>
        <div class="jp-path">
          <code class="jp-code">{{ path || '...' }}</code>
          <button class="jp-copy" @click="copy(path, 'path')">
            {{ copied === 'path' ? $t('remote.jsonc_copied') : $t('remote.jsonc_copy') }}
          </button>
        </div>
      </section>
      <section class="jp-sec">
        <textarea
          v-model="text"
          class="jp-input"
          spellcheck="false"
          :placeholder="$t('remote.jsonc_placeholder')"
        />
        <div class="jp-actions">
          <button class="jp-submit" :disabled="!text.trim()" @click="submit">{{ $t('remote.jsonc_submit') }}</button>
          <span class="jp-status">{{ status }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.jp { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.jp-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.jp-ttl { flex: 1; font-weight: 700; color: var(--tx1); }
.jp-close { background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; }
.jp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.jp-sec { display: flex; flex-direction: column; gap: 8px; }
.jp-h { margin: 0; font-size: 13px; color: var(--tx2); font-weight: 600; }
.jp-ex { display: flex; align-items: center; gap: 8px; }
.jp-exlabel { flex: none; font-size: 12px; color: var(--tx3); min-width: 40px; }
.jp-code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: var(--bg2); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 8px; font-size: 12px; color: var(--tx1); }
.jp-copy { flex: none; background: var(--bg2); color: var(--tx2); border: 1px solid var(--bd2); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.jp-fields { width: 100%; border-collapse: collapse; font-size: 12px; }
.jp-fields td { border-top: 1px solid var(--bd2); padding: 5px 6px; vertical-align: top; }
.jp-fname { width: 64px; color: var(--ac); font-family: monospace; white-space: nowrap; }
.jp-fdesc { color: var(--tx3); }
.jp-path { display: flex; align-items: center; gap: 8px; }
.jp-input { width: 100%; min-height: 140px; box-sizing: border-box; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd2); border-radius: 6px; padding: 8px; font-family: monospace; font-size: 13px; resize: vertical; }
.jp-actions { display: flex; align-items: center; gap: 10px; }
.jp-submit { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 6px 18px; cursor: pointer; font-size: 13px; font-weight: 600; }
.jp-submit:disabled { opacity: .6; cursor: default; }
.jp-status { flex: 1; min-width: 0; font-size: 12px; color: var(--tx3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
