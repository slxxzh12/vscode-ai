<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useLlm, type LlmStatus, type LlmToken, type LlmPluginEntry, type LlmProvider } from '../useLlm';
import ChangePassphraseDialog from './ChangePassphraseDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ModelSetupCard from './ModelSetupCard.vue';
import { t } from '../i18n';

const api = useLlm();
const st = ref<LlmStatus | null>(null);
const tokens = ref<LlmToken[]>([]);
const pluginList = ref<LlmPluginEntry[]>([]);
const pluginDir = ref('');
const pluginTemplate = ref('');
const exampleCopied = ref(false);
let exampleTimer: ReturnType<typeof setTimeout> | null = null;
const pass = ref('');
const changeOpen = ref(false);
const needSecretOpen = ref(false);
const resetOpen = ref(false);
const regenOpen = ref(false);
const secret = ref('');
const employeeId = ref('');
const days = ref(30);
const err = ref('');
const expanded = ref<string | null>(null);
const rowKeys = ref<string[]>([]);
const rowManual = ref<Record<string, string>>({});
const allModelKeys = () => (st.value?.providers || []).flatMap((p) => p.models.map((m) => `${p.id}::${m}`));
const configText = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

// 上游 key 明文：默认打星号，点「查看明文」时才按需向后端取（不常驻前端）
const MASK_KEY = '••••••••';
const revealedKeys = ref<Set<string>>(new Set());
const keyText = ref<Record<string, string>>({});
const keyBusy = ref<string | null>(null);
function keyDisplay(p: LlmProvider) {
  return revealedKeys.value.has(p.id) ? (keyText.value[p.id] || MASK_KEY) : MASK_KEY;
}
async function toggleKey(p: LlmProvider) {
  const next = new Set(revealedKeys.value);
  if (next.has(p.id)) { next.delete(p.id); revealedKeys.value = next; return; }
  if (!(p.id in keyText.value)) {
    keyBusy.value = p.id;
    try {
      const r = await api.providerKeys(p.id);
      const keys = (r.apiKeys && r.apiKeys.length ? r.apiKeys : [r.apiKey]).filter(Boolean);
      keyText.value = { ...keyText.value, [p.id]: keys.join('  ·  ') };
    } catch (e: any) { err.value = t('llm.failed', { msg: e?.message || e }); return; }
    finally { keyBusy.value = null; }
  }
  next.add(p.id);
  revealedKeys.value = next;
}

// —— 中转接口说明/curl 示例（取默认 provider 生成）——
const defProvider = computed(() => {
  const list = st.value?.providers || [];
  return list.find((p) => p.id === st.value?.defaultProvider) || list[0] || null;
});
const relayBase = computed(() => {
  const p = defProvider.value;
  if (!p) return '';
  let bp = '';
  try { bp = new URL(p.baseURL).pathname.replace(/\/+$/, ''); } catch { /* ignore */ }
  return `http://${st.value?.host}:${st.value?.port}/api/llm/${encodeURIComponent(p.id)}${bp}`;
});
const proxyCurl = computed(() => {
  const p = defProvider.value;
  if (!p) return '';
  const model = (p.models && p.models[0]) || '<model>';
  return `curl "${relayBase.value}/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" -d '{"model":"${model}","messages":[{"role":"user","content":"Hello!"}]}'`;
});
const curlCopied = ref(false);
let curlTimer: ReturnType<typeof setTimeout> | null = null;
async function copyCurl() {
  if (!proxyCurl.value) return;
  try {
    await navigator.clipboard.writeText(proxyCurl.value);
    curlCopied.value = true;
    if (curlTimer) clearTimeout(curlTimer);
    curlTimer = setTimeout(() => { curlCopied.value = false; }, 1500);
  } catch { /* ignore */ }
}

async function refresh() {
  try {
    st.value = await api.status();
    if (st.value.vault.unlocked && !st.value.enabled) {
      try { await api.setEnabled(true); st.value.enabled = true; } catch { /* ignore */ }
    }
    tokens.value = st.value.vault.unlocked ? (await api.tokens()).tokens : [];
    if (st.value.vault.unlocked) {
      const pl = await api.plugins();
      pluginList.value = pl.entries;
      pluginDir.value = pl.dir || '';
      pluginTemplate.value = pl.template || '';
    } else {
      pluginList.value = [];
    }
  } catch (e: any) {
    err.value = t('llm.failed', { msg: e?.message || e });
  }
}
onMounted(refresh);

async function run(fn: () => Promise<unknown>) {
  err.value = '';
  try { await fn(); await refresh(); } catch (e: any) { err.value = t('llm.failed', { msg: e?.message || e }); }
}
const initVault = () => {
  if (!pass.value) { err.value = t('llm.vault.pass_required'); return; }
  if (!window.confirm(t('llm.vault.init_confirm'))) return;
  return run(() => api.vaultInit(pass.value));
};
const unlockVault = () => run(() => api.vaultUnlock(pass.value));
const lockVault = () => run(() => api.vaultLock());
function onChangeConfirm(v: { oldPass: string; newPass: string }) {
  changeOpen.value = false;
  return run(() => api.vaultPassphrase(v.oldPass, v.newPass));
}
async function resetVault() { resetOpen.value = true; }
async function doResetVault() {
  resetOpen.value = false;
  await run(() => api.vaultReset());
}
const saveSecret = () => run(async () => { await api.setSecret(secret.value); secret.value = ''; });
function genRandomSecret() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  secret.value = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
function regenerateSecret() { regenOpen.value = true; }
async function doRegenerateSecret() {
  regenOpen.value = false;
  await run(() => api.regenerateSecret());
}
const reloadPlugins = () => run(() => api.reloadPlugins());
const openPluginsDir = () => run(() => api.revealPlugins());
const createExample = () => run(() => api.createPluginExample());
async function copyExample() {
  if (!pluginTemplate.value) return;
  try {
    await navigator.clipboard.writeText(pluginTemplate.value);
    exampleCopied.value = true;
    if (exampleTimer) clearTimeout(exampleTimer);
    exampleTimer = setTimeout(() => { exampleCopied.value = false; }, 1500);
  } catch { /* ignore */ }
}
function issue() {
  if (!st.value?.hasSecret) { needSecretOpen.value = true; return; }
  return run(() => api.issue(employeeId.value, Number(days.value)));
}
function onGenerateSecret() {
  needSecretOpen.value = false;
  return run(() => api.regenerateSecret());
}
const revoke = (id: string) => run(() => api.revoke(id));
function selectedProviders() {
  const out: { id: string; models: string[] }[] = [];
  for (const p of st.value?.providers || []) {
    if (p.models.length) {
      const models = p.models.filter((m) => rowKeys.value.includes(`${p.id}::${m}`));
      if (models.length) out.push({ id: p.id, models });
    } else {
      const manual = (rowManual.value[p.id] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (manual.length) out.push({ id: p.id, models: manual });
    }
  }
  return out;
}
function toggleToken(tk: LlmToken) {
  if (expanded.value === tk.id) { expanded.value = null; return; }
  expanded.value = tk.id;
  rowKeys.value = allModelKeys();
  rowManual.value = {};
  configText.value = '';
  loadExamples(tk);
}
async function genConfig(tk: LlmToken) {
  await run(async () => {
    const r = await api.config(tk.id, selectedProviders());
    configText.value = r.config;
  });
}
function bundleUrl(tk: LlmToken) {
  const q = new URLSearchParams({ token: tk.id });
  for (const sel of selectedProviders()) for (const m of sel.models) { q.append('pid', sel.id); q.append('model', m); }
  return `/api/llm-admin/opencode-bundle?${q.toString()}`;
}
const examples = ref<{ nonStream: string; stream: string } | null>(null);
const testing = ref(false);
const testStatus = ref<number | null>(null);
const testOut = ref('');
function primarySel() {
  const s = selectedProviders()[0];
  return s ? { id: s.id, model: s.models[0] } : null;
}
async function loadExamples(tk: LlmToken) {
  examples.value = null;
  const p = primarySel();
  if (!p) return;
  const q = new URLSearchParams({ token: tk.id, pid: p.id, model: p.model });
  try { examples.value = await fetch(`/api/llm-admin/test-example?${q}`).then((x) => x.json()); } catch { /* ignore */ }
}
async function runTest(tk: LlmToken, stream: boolean) {
  err.value = '';
  const sel = selectedProviders()[0];
  if (!sel) { err.value = t('llm.test.need_selection'); return; }
  const p = st.value?.providers.find((x) => x.id === sel.id);
  let basePath = '';
  try { basePath = new URL(p?.baseURL || '').pathname.replace(/\/+$/, ''); } catch { basePath = ''; }
  const url = `/api/llm/${encodeURIComponent(sel.id)}${basePath}/chat/completions`;
  testing.value = true; testStatus.value = null; testOut.value = '';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk.jwt}` },
      body: JSON.stringify({ model: sel.models[0], messages: [{ role: 'user', content: 'Hello!' }], ...(stream ? { stream: true } : {}) }),
    });
    testStatus.value = r.status;
    if (!r.body) { testOut.value = await r.text(); return; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      testOut.value += dec.decode(value, { stream: true });
    }
  } catch (e: any) {
    err.value = t('llm.failed', { msg: e?.message || e });
  } finally {
    testing.value = false;
  }
}
watch(() => rowKeys.value.join('|'), () => {
  const tk = tokens.value.find((x) => x.id === expanded.value);
  if (expanded.value && tk) loadExamples(tk);
});
async function copyConfig() {
  if (!configText.value) return;
  try {
    await navigator.clipboard.writeText(configText.value);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="llm">
    <h3>{{ $t('llm.title') }}</h3>
    <div v-if="err" class="err">{{ err }}</div>

    <section class="card">
      <div class="ch">{{ $t('llm.vault.title') }}
        <span class="badge" :class="{ ok: st?.vault.unlocked }">
          {{ st?.vault.unlocked ? $t('llm.vault.unlocked') : (st?.vault.initialized ? $t('llm.vault.locked') : $t('llm.vault.not_init')) }}
        </span>
      </div>
      <div class="muted">{{ $t('llm.vault.desc') }}</div>
      <div class="warn">{{ $t('llm.vault.warn_lost') }}</div>
      <div v-if="!st?.vault.initialized" class="row">
        <input v-model="pass" type="password" :placeholder="$t('llm.vault.passphrase')" />
        <button @click="initVault">{{ $t('llm.vault.init') }}</button>
      </div>
      <div v-else-if="!st?.vault.unlocked" class="row">
        <input v-model="pass" type="password" :placeholder="$t('llm.vault.passphrase')" @keyup.enter="unlockVault" />
        <button @click="unlockVault">{{ $t('llm.vault.show_tokens') }}</button>
      </div>
      <div v-else class="row vault-actions">
        <button class="lockbtn" @click="lockVault">{{ $t('llm.vault.close_tokens') }}</button>
        <div class="vault-right">
          <button class="ghost" @click="changeOpen = true">{{ $t('llm.vault.change') }}</button>
          <button class="danger" @click="resetVault">{{ $t('llm.vault.reset') }}</button>
        </div>
      </div>
    </section>

    <ChangePassphraseDialog :open="changeOpen" @confirm="onChangeConfirm" @cancel="changeOpen = false" />

    <ConfirmDialog
      :open="needSecretOpen"
      :title="$t('llm.secret.need_title')"
      :message="$t('llm.secret.need_msg')"
      :confirm-text="$t('llm.secret.regenerate')"
      :cancel-text="$t('common.cancel')"
      type="warning"
      @confirm="onGenerateSecret"
      @cancel="needSecretOpen = false"
    />

    <ConfirmDialog
      :open="resetOpen"
      :title="$t('llm.vault.reset')"
      :message="$t('llm.vault.reset_confirm')"
      :confirm-text="$t('common.ok')"
      :cancel-text="$t('common.cancel')"
      type="danger"
      @confirm="doResetVault"
      @cancel="resetOpen = false"
    />

    <ConfirmDialog
      :open="regenOpen"
      :title="$t('llm.secret.regenerate')"
      :message="$t('llm.secret.regenerate_prompt')"
      :confirm-text="$t('common.ok')"
      :cancel-text="$t('common.cancel')"
      type="danger"
      require-text="REGENERATE"
      placeholder="REGENERATE"
      @confirm="doRegenerateSecret"
      @cancel="regenOpen = false"
    />

    <section class="card">
      <div class="ch">{{ $t('llm.provider.title') }}</div>
      <div v-if="!st?.providers.length" class="muted">{{ $t('llm.provider.none') }}</div>
      <div v-for="p in st?.providers || []" :key="p.id" class="pcard">
        <div class="prow">
          <b>{{ p.id }}</b><span class="muted">{{ p.baseURL }}</span>
          <span v-if="!p.baseURL" class="warn">{{ $t('llm.provider.nobase') }}</span>
          <span v-if="!p.hasKey" class="warn">{{ $t('llm.provider.nokey') }}</span>
        </div>
        <div v-if="p.hasKey" class="prow keyrow">
          <span class="keylabel">{{ $t('llm.provider.key') }}</span>
          <code class="keyval" :class="{ shown: revealedKeys.has(p.id) }">{{ keyDisplay(p) }}</code>
          <button class="ghost" :disabled="keyBusy === p.id" @click="toggleKey(p)">
            {{ keyBusy === p.id ? $t('llm.provider.loading') : (revealedKeys.has(p.id) ? $t('llm.provider.hide') : $t('llm.provider.reveal')) }}
          </button>
        </div>
      </div>
    </section>

    <ModelSetupCard @saved="refresh" />

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.proxy.title') }}
        <span class="badge" :class="{ ok: st?.enabled }">{{ st?.enabled ? $t('llm.proxy.on') : $t('llm.proxy.off') }}</span>
      </div>
      <div class="muted">{{ $t('llm.proxy.listen', { host: st?.host, port: st?.port }) }}</div>
      <div class="warn">{{ $t('llm.proxy.warn') }}</div>
      <div class="muted">{{ $t('llm.proxy.endpoint') }}</div>
      <pre class="cfg">{{ relayBase }}/chat/completions</pre>
      <div class="row">
        <span class="muted">{{ $t('llm.proxy.curl_hint') }}</span>
        <button class="ghost" @click="copyCurl">{{ curlCopied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
      </div>
      <pre class="cfg">{{ proxyCurl }}</pre>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.plugins.title') }}
        <span class="row">
          <button class="ghost" @click="reloadPlugins">{{ $t('llm.plugins.reload') }}</button>
          <button class="ghost" @click="createExample">{{ $t('llm.plugins.new') }}</button>
          <button class="ghost" @click="openPluginsDir">{{ $t('llm.plugins.open') }}</button>
        </span>
      </div>
      <div class="muted">{{ $t('llm.plugins.dir', { dir: pluginDir }) }}</div>
      <div class="muted">{{ $t('llm.plugins.hint') }}</div>
      <div v-if="!pluginList.length" class="muted">{{ $t('llm.plugins.empty') }}</div>
      <div v-for="p in pluginList" :key="p.file + '::' + p.name" class="prow">
        <b>{{ p.name || p.file }}</b>
        <span class="muted">{{ p.file }} · p{{ p.priority }}</span>
        <span v-if="p.error" class="warn">{{ $t('llm.plugins.error') }}</span>
      </div>
      <details class="ex">
        <summary>{{ $t('llm.plugins.example.title') }}
          <button class="ghost" @click.prevent="copyExample">{{ exampleCopied ? $t('llm.plugins.example.copied') : $t('llm.plugins.example.copy') }}</button>
        </summary>
        <pre class="cfg">{{ pluginTemplate }}</pre>
      </details>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.token.title') }}</div>

      <div class="ch">{{ $t('llm.secret.title') }}
        <span class="badge" :class="{ ok: st?.hasSecret }">{{ st?.hasSecret ? $t('llm.secret.configured') : $t('llm.secret.not_set') }}</span>
      </div>
      <div class="muted">{{ $t('llm.secret.hint') }}</div>
      <div v-if="!st?.hasSecret" class="row">
        <input v-model="secret" :placeholder="$t('llm.secret.placeholder')" />
        <button @click="saveSecret">{{ $t('llm.secret.set') }}</button>
        <button class="ghost" @click="genRandomSecret">{{ $t('llm.secret.random') }}</button>
      </div>
      <div v-else class="row">
        <button class="danger" @click="regenerateSecret">{{ $t('llm.secret.regenerate') }}</button>
      </div>

      <div class="row">
        <input v-model="employeeId" :placeholder="$t('llm.token.employee')" />
        <input v-model.number="days" type="number" min="1" class="days" :placeholder="$t('llm.token.days')" />
        <button @click="issue">{{ $t('llm.token.issue') }}</button>
      </div>
      <div v-if="!tokens.length" class="muted">{{ $t('llm.token.none') }}</div>
      <div v-for="tk in tokens" :key="tk.id" class="tok">
        <div class="trow trow-click" @click="toggleToken(tk)">
          <b>{{ tk.employeeId }}</b>
          <span class="muted">{{ new Date(tk.exp * 1000).toLocaleDateString() }}{{ tk.revoked ? ' · ' + $t('llm.token.revoked') : '' }}</span>
          <button class="ghost" :disabled="tk.revoked" @click.stop="revoke(tk.id)">×</button>
        </div>
        <div v-if="expanded === tk.id" class="tok-body">
          <div class="row">
            <button @click="genConfig(tk)">{{ $t('llm.config.generate') }}</button>
            <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
            <a class="dlbtn" :href="bundleUrl(tk)" download>{{ $t('llm.config.download') }}</a>
            <button class="ghost" @click="rowKeys = allModelKeys()">{{ $t('llm.config.all') }}</button>
            <button class="ghost" @click="rowKeys = []">{{ $t('llm.config.none') }}</button>
          </div>
          <div v-for="p in st?.providers || []" :key="p.id" class="pvgroup">
            <div class="pvname">{{ p.id }}</div>
            <div v-if="p.models.length" class="models">
              <label v-for="m in p.models" :key="m" class="mchk">
                <input type="checkbox" :value="p.id + '::' + m" v-model="rowKeys" /> {{ m }}
              </label>
            </div>
            <div v-else class="row">
              <input v-model="rowManual[p.id]" :placeholder="$t('llm.config.manual')" />
            </div>
          </div>
          <div v-if="examples" class="tests">
            <div class="tlabel">{{ $t('llm.test.non_stream') }}</div>
            <pre class="cfg">{{ examples.nonStream }}</pre>
            <button class="ghost" :disabled="testing" @click="runTest(tk, false)">{{ $t('llm.test.run') }}</button>
            <div class="tlabel">{{ $t('llm.test.stream') }}</div>
            <pre class="cfg">{{ examples.stream }}</pre>
            <button class="ghost" :disabled="testing" @click="runTest(tk, true)">{{ $t('llm.test.run') }}</button>
            <div v-if="testing || testStatus !== null" class="tlabel">{{ $t('llm.test.response') }} <span v-if="testStatus !== null">· HTTP {{ testStatus }}</span></div>
            <pre v-if="testing || testOut" class="cfg">{{ testOut }}<span v-if="testing" class="cursor">▊</span></pre>
          </div>
          <div v-else-if="!selectedProviders().length" class="muted">{{ $t('llm.test.need_selection') }}</div>
          <div class="muted">{{ $t('llm.config.download_hint') }}</div>
          <pre v-if="configText" class="cfg">{{ configText }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.llm { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow: auto; height: 100%; box-sizing: border-box; }
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
.row .days { width: 80px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button.danger { background: none; border-color: var(--err); color: var(--err); }
button.lockbtn { background: var(--err); border-color: var(--err); color: #fff; font-weight: 700; padding: 10px 26px; font-size: 14px; }
.vault-right { margin-left: auto; display: flex; gap: 6px; }
button:disabled { opacity: .5; cursor: default; }
.badge { font-size: 11px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; }
.badge.ok { color: var(--ac2); border-color: var(--ac2); }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prow, .trow { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.prow .muted, .trow .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcard { display: flex; flex-direction: column; gap: 2px; }
.keyrow { gap: 6px; }
.keylabel { flex: none; color: var(--tx4); font-size: 12px; }
.keyval { flex: 0 1 auto; min-width: 0; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--tx4); background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 1px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.keyval.shown { color: var(--tx1); }
.sw { font-weight: 400; font-size: 12px; display: flex; gap: 4px; align-items: center; }
.tok { border: 1px solid var(--bd); border-radius: 6px; overflow: hidden; }
.trow-click { cursor: pointer; padding: 6px 8px; }
.tok-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--bd); background: var(--bg1); }
.models { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); }
.pvgroup { display: flex; flex-direction: column; gap: 4px; }
.pvname { color: var(--tx2); font-size: 12px; font-weight: 700; }
.tests { display: flex; flex-direction: column; gap: 4px; }
.tlabel { color: var(--tx3); font-size: 12px; margin-top: 4px; }
.cursor { color: var(--ac); }
.dlbtn { display: inline-flex; align-items: center; background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; text-decoration: none; font-size: 13px; }
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
.ex summary { cursor: pointer; color: var(--tx2); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.ex .cfg { margin-top: 8px; }
</style>
