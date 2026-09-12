<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  parseCurlCommands, replaceCurlCommand, splitUrl, joinUrl,
  type CurlEntry, type CurlRequest, type QueryParam,
} from '../curl';
import { t } from '../i18n';

const props = defineProps<{ projectId: string; path: string; text: string }>();
const emit = defineEmits<{ (e: 'update:text', text: string): void }>();

const localText = ref(props.text);
const entries = computed<CurlEntry[]>(() => parseCurlCommands(localText.value));
const selected = ref(0);
const method = ref('GET');
const baseUrl = ref('');
const params = ref<QueryParam[]>([]);
const headersText = ref('');
const bodyRaw = ref('');
const sending = ref(false);
const err = ref('');
const respStatus = ref<number | null>(null);
const respText = ref('');

watch(() => props.text, (tx) => {
  if (tx !== localText.value) { localText.value = tx; syncFromEntries(); }
});
watch(selected, syncForm);
watch(entries, () => {
  if (selected.value >= entries.value.length) selected.value = Math.max(0, entries.value.length - 1);
  syncForm();
});
onMounted(syncFromEntries);

function current(): CurlEntry | undefined { return entries.value[selected.value]; }
function syncFromEntries() {
  if (selected.value >= entries.value.length) selected.value = Math.max(0, entries.value.length - 1);
  syncForm();
}
function syncForm() {
  const e = current();
  if (!e) { method.value = 'GET'; baseUrl.value = ''; params.value = []; headersText.value = ''; bodyRaw.value = ''; return; }
  method.value = e.request.method;
  const s = splitUrl(e.request.url);
  baseUrl.value = s.base;
  params.value = s.params;
  headersText.value = e.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  bodyRaw.value = e.request.body;
}
function readHeaders(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const line of headersText.value.split('\n')) {
    const c = line.indexOf(':');
    if (c > 0) out.push({ name: line.slice(0, c).trim(), value: line.slice(c + 1).trim() });
  }
  return out;
}
function commit(next: string) {
  localText.value = next;
  emit('update:text', next);
}
function applyForm() {
  const e = current();
  if (!e) return;
  const req: CurlRequest = { method: method.value.toUpperCase(), url: joinUrl(baseUrl.value, params.value), headers: readHeaders(), body: bodyRaw.value, raw: '' };
  commit(replaceCurlCommand(localText.value, e, req));
}
function addRequest() {
  const tpl = "curl -X GET 'https://example.com'";
  const sep = localText.value && !localText.value.endsWith('\n') ? '\n' : '';
  const next = `${localText.value}${sep}${tpl}\n`;
  commit(next);
  selected.value = parseCurlCommands(next).length - 1;
}
function deleteRequest() {
  const e = current();
  if (!e) return;
  const next = (localText.value.slice(0, e.start) + localText.value.slice(e.end)).replace(/\n{3,}/g, '\n\n');
  commit(next);
  selected.value = Math.max(0, selected.value - 1);
}
function addParam() { params.value.push({ name: '', value: '' }); applyForm(); }
function removeParam(i: number) { params.value.splice(i, 1); applyForm(); }
async function send() {
  if (!current()) return;
  const url = joinUrl(baseUrl.value, params.value);
  if (!url) { err.value = t('fp.curl_url_required'); return; }
  err.value = ''; sending.value = true; respStatus.value = null; respText.value = '';
  try {
    const headers: Record<string, string> = {};
    for (const h of readHeaders()) if (h.name) headers[h.name] = h.value;
    const m = method.value.toUpperCase();
    const r = await fetch(url, { method: m, headers, body: ['GET', 'HEAD'].includes(m) ? undefined : (bodyRaw.value || undefined) });
    respStatus.value = r.status;
    const body = await r.text();
    respText.value = body.length > 300000 ? body.slice(0, 300000) + t('fp.truncated') : body;
  } catch (ex: any) {
    err.value = t('fp.request_failed', { msg: ex?.message || ex });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="curlview">
    <div class="cvlist">
      <div class="cvhead">
        <span>{{ $t('fp.curl.collection') }}</span>
        <button class="cvx" @click="addRequest">＋</button>
      </div>
      <button v-for="(e, i) in entries" :key="i" class="cvitem" :class="{ on: i === selected }" @click="selected = i">
        <b>{{ e.request.method }}</b> {{ e.request.url }}
      </button>
    </div>
    <div class="cvform">
      <div v-if="!entries.length" class="cvempty">{{ $t('fp.curl_no_command') }}</div>
      <template v-else>
        <div class="cvrow">
          <input v-model="method" class="cvm" @change="applyForm" />
          <input v-model="baseUrl" class="cvu" placeholder="https://…" @change="applyForm" />
          <button class="cvbtn" :disabled="sending" @click="send">{{ sending ? $t('fp.curl.sending') : $t('fp.curl.send') }}</button>
          <button class="cvbtn danger" @click="deleteRequest">{{ $t('fp.curl.delete') }}</button>
        </div>
        <label class="cvlab">{{ $t('fp.curl.query') }}</label>
        <div v-for="(p, i) in params" :key="i" class="cvparam">
          <input v-model="p.name" class="cvpn" placeholder="name" @change="applyForm" />
          <input v-model="p.value" class="cvp" placeholder="value" @change="applyForm" />
          <button class="cvx" @click="removeParam(i)">×</button>
        </div>
        <button class="cvmini" @click="addParam">＋ {{ $t('fp.curl.add_param') }}</button>
        <label class="cvlab">{{ $t('fp.curl.headers') }}</label>
        <textarea v-model="headersText" class="cvta" rows="3" :placeholder="$t('fp.curl.headers_placeholder')" @change="applyForm" />
        <label class="cvlab">{{ $t('fp.curl.body') }}</label>
        <textarea v-model="bodyRaw" class="cvta" rows="4" :placeholder="$t('fp.curl.body_placeholder')" @change="applyForm" />
        <div v-if="err" class="cverr">{{ err }}</div>
        <label class="cvlab">{{ $t('fp.curl.response') }}</label>
        <div v-if="respStatus !== null" class="cvstat">HTTP {{ respStatus }}</div>
        <pre v-if="respText" class="cvpre">{{ respText }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.curlview { display: flex; flex: 1; min-height: 0; }
.cvlist { width: 220px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.cvhead { display: flex; align-items: center; justify-content: space-between; color: var(--tx3); font-size: 12px; padding: 2px 4px; }
.cvitem { text-align: left; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--tx2); padding: 4px 6px; font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }
.cvitem:hover { background: var(--bg5); }
.cvitem.on { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.cvform { flex: 1; min-width: 0; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.cvrow { display: flex; gap: 6px; align-items: center; }
.cvm { width: 90px; }
.cvu { flex: 1; min-width: 0; }
.cvpn { width: 140px; }
.cvp { flex: 1; min-width: 0; }
.cvparam { display: flex; gap: 6px; align-items: center; }
.cvempty { color: var(--tx4); font-size: 13px; padding: 20px; }
.cvlab { color: var(--tx3); font-size: 12px; margin-top: 4px; }
.cvta, .cvform input { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.cvbtn { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
.cvbtn.danger { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
.cvmini { align-self: flex-start; background: var(--bg5); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.cvx { background: none; border: none; color: var(--tx3); cursor: pointer; font-size: 14px; }
.cvstat { color: var(--tx3); font-size: 12px; }
.cvpre { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 40vh; white-space: pre-wrap; word-break: break-all; }
.cverr { color: var(--err); font-size: 12px; }
</style>
