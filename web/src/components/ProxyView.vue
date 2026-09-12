<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useLlm, type LlmStatus, type LlmToken, type LlmPluginEntry } from '../useLlm';
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
const newPass = ref('');
const secret = ref('');
const employeeId = ref('');
const days = ref(30);
const err = ref('');
const expanded = ref<string | null>(null);
const rowProvider = ref('');
const rowModels = ref<string[]>([]);
const rowManual = ref('');
const providerById = (id: string) => st.value?.providers.find((p) => p.id === id) || null;
const configText = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh() {
  try {
    st.value = await api.status();
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
const changePass = () => run(() => api.vaultPassphrase(pass.value, newPass.value));
async function resetVault() {
  if (!window.confirm(t('llm.vault.reset_confirm'))) return;
  await run(() => api.vaultReset());
}
const saveSecret = () => run(async () => { await api.setSecret(secret.value); secret.value = ''; });
async function regenerateSecret() {
  const word = window.prompt(t('llm.secret.regenerate_prompt'));
  if (word === null) return;
  if (word.trim().toUpperCase() !== 'REGENERATE') { err.value = t('llm.secret.regenerate_mismatch'); return; }
  await run(() => api.regenerateSecret());
}
const toggleEnabled = () => run(() => api.setEnabled(!st.value?.enabled));
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
const issue = () => run(() => api.issue(employeeId.value, Number(days.value)));
const revoke = (id: string) => run(() => api.revoke(id));
function toggleToken(tk: LlmToken) {
  if (expanded.value === tk.id) { expanded.value = null; return; }
  expanded.value = tk.id;
  rowProvider.value = st.value?.defaultProvider || st.value?.providers[0]?.id || '';
  rowModels.value = (providerById(rowProvider.value)?.models || []).slice();
  rowManual.value = '';
  configText.value = '';
}
function onProviderChange() {
  rowModels.value = (providerById(rowProvider.value)?.models || []).slice();
}
async function genConfig(tk: LlmToken) {
  await run(async () => {
    const p = providerById(rowProvider.value);
    const models = p && p.models.length ? rowModels.value : rowManual.value.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await api.config(rowProvider.value, tk.id, models);
    configText.value = r.config;
  });
}
function bundleUrl(tk: LlmToken) {
  const p = providerById(rowProvider.value);
  const models = p && p.models.length ? rowModels.value : rowManual.value.split(',').map((s) => s.trim()).filter(Boolean);
  const q = new URLSearchParams({ provider: rowProvider.value, token: tk.id });
  for (const m of models) q.append('models', m);
  return `/api/llm-admin/opencode-bundle?${q.toString()}`;
}
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
        <button @click="unlockVault">{{ $t('llm.vault.unlock') }}</button>
      </div>
      <div v-else class="row">
        <input v-model="pass" type="password" :placeholder="$t('llm.vault.old')" />
        <input v-model="newPass" type="password" :placeholder="$t('llm.vault.new')" />
        <button @click="changePass">{{ $t('llm.vault.change') }}</button>
        <button class="ghost" @click="lockVault">{{ $t('llm.vault.lock') }}</button>
      </div>
      <div v-if="st?.vault.initialized" class="row">
        <button class="danger" @click="resetVault">{{ $t('llm.vault.reset') }}</button>
      </div>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.secret.title') }}
        <span class="badge" :class="{ ok: st?.hasSecret }">{{ st?.hasSecret ? $t('llm.secret.configured') : $t('llm.secret.not_set') }}</span>
      </div>
      <div class="muted">{{ $t('llm.secret.hint') }}</div>
      <div v-if="!st?.hasSecret" class="row">
        <input v-model="secret" :placeholder="$t('llm.secret.placeholder')" />
        <button @click="saveSecret">{{ $t('llm.secret.set') }}</button>
      </div>
      <div v-else class="row">
        <button class="danger" @click="regenerateSecret">{{ $t('llm.secret.regenerate') }}</button>
      </div>
    </section>

    <section class="card">
      <div class="ch">{{ $t('llm.provider.title') }}</div>
      <div v-if="!st?.providers.length" class="muted">{{ $t('llm.provider.none') }}</div>
      <div v-for="p in st?.providers || []" :key="p.id" class="prow">
        <b>{{ p.id }}</b><span class="muted">{{ p.baseURL }}</span>
        <span v-if="!p.hasKey" class="warn">{{ $t('llm.provider.nokey') }}</span>
      </div>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.proxy.title') }}
        <label class="sw"><input type="checkbox" :checked="st?.enabled" @change="toggleEnabled" /> {{ $t('llm.proxy.enable') }}</label>
      </div>
      <div class="muted">{{ $t('llm.proxy.listen', { host: st?.host, port: st?.port }) }}</div>
      <div class="warn">{{ $t('llm.proxy.warn') }}</div>
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
            <select v-model="rowProvider" @change="onProviderChange">
              <option v-for="p in st?.providers || []" :key="p.id" :value="p.id">{{ p.id }}</option>
            </select>
            <button @click="genConfig(tk)">{{ $t('llm.config.generate') }}</button>
            <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
            <a class="dlbtn" :href="bundleUrl(tk)" download>{{ $t('llm.config.download') }}</a>
          </div>
          <div v-if="(providerById(rowProvider)?.models || []).length" class="models">
            <span class="muted">{{ $t('llm.config.models') }}</span>
            <label v-for="m in providerById(rowProvider)?.models || []" :key="m" class="mchk">
              <input type="checkbox" :value="m" v-model="rowModels" /> {{ m }}
            </label>
            <button class="ghost" @click="rowModels = (providerById(rowProvider)?.models || []).slice()">{{ $t('llm.config.all') }}</button>
            <button class="ghost" @click="rowModels = []">{{ $t('llm.config.none') }}</button>
          </div>
          <div v-else class="row">
            <input v-model="rowManual" :placeholder="$t('llm.config.manual')" />
          </div>
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
button:disabled { opacity: .5; cursor: default; }
.badge { font-size: 11px; color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; }
.badge.ok { color: var(--ac2); border-color: var(--ac2); }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prow, .trow { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.prow .muted, .trow .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw { font-weight: 400; font-size: 12px; display: flex; gap: 4px; align-items: center; }
.tok { border: 1px solid var(--bd); border-radius: 6px; overflow: hidden; }
.trow-click { cursor: pointer; padding: 6px 8px; }
.tok-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--bd); background: var(--bg1); }
.models { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); }
.dlbtn { display: inline-flex; align-items: center; background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; text-decoration: none; font-size: 13px; }
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
.ex summary { cursor: pointer; color: var(--tx2); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.ex .cfg { margin-top: 8px; }
</style>
