<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useLlm, type LlmStatus, type LlmToken } from '../useLlm';
import { t } from '../i18n';

const api = useLlm();
const st = ref<LlmStatus | null>(null);
const tokens = ref<LlmToken[]>([]);
const pass = ref('');
const newPass = ref('');
const secret = ref('');
const employeeId = ref('');
const days = ref(30);
const err = ref('');
const cfgProvider = ref('');
const cfgToken = ref('');
const configText = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh() {
  try {
    st.value = await api.status();
    if (st.value.providers.length && !cfgProvider.value) cfgProvider.value = st.value.defaultProvider || st.value.providers[0].id;
    tokens.value = st.value.vault.unlocked ? (await api.tokens()).tokens : [];
  } catch (e: any) {
    err.value = t('llm.failed', { msg: e?.message || e });
  }
}
onMounted(refresh);

async function run(fn: () => Promise<unknown>) {
  err.value = '';
  try { await fn(); await refresh(); } catch (e: any) { err.value = t('llm.failed', { msg: e?.message || e }); }
}
const initVault = () => run(() => api.vaultInit(pass.value));
const unlockVault = () => run(() => api.vaultUnlock(pass.value));
const lockVault = () => run(() => api.vaultLock());
const changePass = () => run(() => api.vaultPassphrase(pass.value, newPass.value));
async function resetVault() {
  if (!window.confirm(t('llm.vault.reset_confirm'))) return;
  await run(() => api.vaultReset());
}
const saveSecret = () => run(() => api.setSecret(secret.value));
const toggleEnabled = () => run(() => api.setEnabled(!st.value?.enabled));
const issue = () => run(() => api.issue(employeeId.value, Number(days.value)));
const revoke = (id: string) => run(() => api.revoke(id));
async function genConfig() {
  await run(async () => {
    const r = await api.config(cfgProvider.value, cfgToken.value);
    configText.value = r.config;
  });
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
      <div class="ch">{{ $t('llm.secret.title') }}</div>
      <div class="muted">{{ $t('llm.secret.hint') }}</div>
      <div class="row">
        <input v-model="secret" :placeholder="$t('llm.secret.placeholder')" />
        <button @click="saveSecret">{{ $t('llm.secret.set') }}</button>
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
      <div class="ch">{{ $t('llm.token.title') }}</div>
      <div class="row">
        <input v-model="employeeId" :placeholder="$t('llm.token.employee')" />
        <input v-model.number="days" type="number" min="1" class="days" :placeholder="$t('llm.token.days')" />
        <button @click="issue">{{ $t('llm.token.issue') }}</button>
      </div>
      <div v-if="!tokens.length" class="muted">{{ $t('llm.token.none') }}</div>
      <div v-for="tk in tokens" :key="tk.id" class="trow">
        <b>{{ tk.employeeId }}</b>
        <span class="muted">{{ new Date(tk.exp * 1000).toLocaleDateString() }}{{ tk.revoked ? ' · ' + $t('llm.token.revoked') : '' }}</span>
        <button class="ghost" :disabled="tk.revoked" @click="revoke(tk.id)">×</button>
      </div>
    </section>

    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.config.title') }}</div>
      <div class="row">
        <select v-model="cfgProvider">
          <option v-for="p in st?.providers || []" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <select v-model="cfgToken">
          <option v-for="tk in tokens.filter((x) => !x.revoked)" :key="tk.id" :value="tk.id">{{ tk.employeeId }}</option>
        </select>
        <button @click="genConfig">{{ $t('llm.config.generate') }}</button>
        <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
      </div>
      <pre v-if="configText" class="cfg">{{ configText }}</pre>
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
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
</style>
