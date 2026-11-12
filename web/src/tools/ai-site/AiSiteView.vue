<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { copyText } from '../../clipboard';
import { useAiSite, type AiSiteConfig, type AiSiteUser } from './useAiSite';

const api = useAiSite();
const form = ref<AiSiteConfig | null>(null);
const msg = ref('');
const busy = ref(false);
const newUser = ref('');
const newExpiry = ref(defaultExpiry());

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function defaultExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return ymd(d);
}
function expToDate(exp: number): string {
  return exp > 0 ? ymd(new Date(exp * 1000)) : '';
}
function dateToExp(value: string): number {
  if (!value) return 0;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).getTime();
}
function isExpired(u: AiSiteUser): boolean {
  return Number(u.exp) > 0 && Date.now() >= Number(u.exp) * 1000;
}

function baseHost(): string {
  const c = form.value;
  if (!c) return '';
  if (c.mode === 'port') return `http://${location.hostname}:${c.listenPort}`;
  return `${location.origin}${c.pathPrefix}`;
}
function accessUrl(): string { return `${baseHost()}/`; }

onMounted(async () => {
  try {
    await api.load();
    form.value = api.config.value ? { ...api.config.value } : null;
  } catch (e) { msg.value = String((e as Error)?.message || e); }
});

async function pickDir() {
  try {
    const r = await api.pickFolder();
    if (r.error) { msg.value = r.error === 'unsupported' ? t('nginx.pick_unsupported') : t('nginx.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path || !form.value) return;
    form.value = { ...form.value, pluginRoot: r.path };
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function doSave() {
  if (!form.value) return;
  busy.value = true; msg.value = '';
  try {
    const saved = await api.save(form.value);
    form.value = { ...saved };
    msg.value = t('nginx.saved_ok');
  } catch (e) { msg.value = String((e as Error)?.message || e); } finally { busy.value = false; }
}

async function toggle() {
  busy.value = true;
  try {
    if (api.status.value?.status === 'running') await api.stop(); else await api.start();
    form.value = api.config.value ? { ...api.config.value } : null;
  } catch (e) { msg.value = String((e as Error)?.message || e); } finally { busy.value = false; }
}

async function addUser() {
  const name = newUser.value.trim();
  if (!name) return;
  try {
    const u = await api.createUser(name, dateToExp(newExpiry.value));
    newUser.value = '';
    newExpiry.value = defaultExpiry();
    await copyText(u.jwt);
    msg.value = t('nginx.copied');
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function toggleUser(u: AiSiteUser) {
  try { await api.updateUser(u.id, { enabled: !u.enabled }); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function onExpiryChange(u: AiSiteUser, e: Event) {
  const value = (e.target as HTMLInputElement).value;
  try { await api.updateUser(u.id, { expiresAt: dateToExp(value) }); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function toggleRevoke(u: AiSiteUser) {
  const action = u.revoked ? t('ai_site.user.unrevoke') : t('ai_site.user.revoke');
  try { await ElMessageBox.confirm(u.username, action, { type: 'warning' }); } catch { return; }
  try { await api.revokeUser(u.username, !u.revoked); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function removeUser(u: AiSiteUser) {
  try { await ElMessageBox.confirm(u.username, t('nginx.delete'), { type: 'warning' }); } catch { return; }
  try { await api.removeUser(u.id); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function copyAccess() { await copyText(accessUrl()); msg.value = t('nginx.copied'); }
function openSite() { window.open(accessUrl(), '_blank', 'noopener'); }
async function copyToken(u: AiSiteUser) { await copyText(u.jwt); msg.value = t('nginx.copied'); }
</script>

<template>
  <div v-if="form" class="aibody">
    <section class="aicard">
      <div class="aihead">
        <b>{{ $t('ai_site.title') }}</b>
        <span class="aistat" :class="api.status.value?.status">{{ api.status.value?.status }}</span>
      </div>
      <div class="airow">
        <label class="aigrow">{{ $t('static_site.root_dir') }}
          <input v-model="form.pluginRoot" class="aiin" data-field="plugin-root" :placeholder="$t('nginx.static_dir_ph')" />
        </label>
        <button class="aibtn" @click="pickDir">{{ $t('nginx.pick_dir') }}</button>
      </div>
      <div class="airow">
        <label>{{ $t('nginx.mode') }}
          <select v-model="form.mode" class="aiin" data-field="mode">
            <option value="port">{{ $t('nginx.mode_port') }}</option>
            <option value="path">{{ $t('nginx.mode_path') }}</option>
          </select>
        </label>
        <label v-if="form.mode === 'port'">{{ $t('nginx.listen') }}
          <input v-model.number="form.listenPort" type="number" class="aiin" min="1" max="65535" data-field="listen-port" />
        </label>
        <label v-else>{{ $t('nginx.path_prefix') }}
          <input v-model="form.pathPrefix" class="aiin" placeholder="/ai" data-field="path-prefix" />
        </label>
        <label class="aichk"><input v-model="form.requireAuth" type="checkbox" data-field="require-auth" />{{ $t('ai_site.login.title') }}</label>
      </div>
      <div class="aiactions">
        <button class="aibtn primary" :disabled="busy" @click="doSave">{{ $t('nginx.saved') }}</button>
        <button class="aibtn" :class="{ start: api.status.value?.status !== 'running' }" :disabled="busy" @click="toggle">{{ api.status.value?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
        <span class="aimsg">{{ msg }}</span>
      </div>
      <div class="aiurl">
        <code>{{ accessUrl() }}</code>
        <button class="aibtn" @click="copyAccess">{{ $t('nginx.copy') }}</button>
        <button class="aibtn" @click="openSite">{{ $t('static_site.open') }}</button>
      </div>
    </section>

    <section class="aicard">
      <div class="aihead"><b>{{ $t('ai_site.login.title') }}</b></div>
      <div class="airow">
        <input v-model="newUser" class="aiin" data-field="new-user" :placeholder="$t('ai_site.login.username')" />
        <label class="aiexp">{{ $t('ai_site.user.expires') }}
          <input v-model="newExpiry" type="date" class="aiin" data-field="new-expiry" />
        </label>
        <button class="aibtn primary" data-action="add-user" @click="addUser">＋ {{ $t('ai_site.user.add') }}</button>
      </div>
      <p class="aihint">{{ $t('ai_site.user.jwt_hint') }}</p>
      <div v-for="u in api.users.value" :key="u.id" class="aiuser">
        <span class="ainame">{{ u.username }}</span>
        <span v-if="u.revoked" class="abadge">{{ $t('ai_site.user.revoked') }}</span>
        <span v-else-if="isExpired(u)" class="abadge">{{ $t('ai_site.user.expired') }}</span>
        <span class="a muted">{{ u.uses }}</span>
        <label class="aiexp">{{ $t('ai_site.user.expires') }}
          <input type="date" class="aiin" :value="expToDate(u.exp)" @change="onExpiryChange(u, $event)" />
        </label>
        <button class="aibtn" data-action="copy-jwt" @click="copyToken(u)">{{ $t('ai_site.user.copy_jwt') }}</button>
        <label class="aichk"><input type="checkbox" :checked="u.enabled" @change="toggleUser(u)" />{{ u.enabled ? 'on' : 'off' }}</label>
        <button class="aibtn" :class="{ danger: !u.revoked }" @click="toggleRevoke(u)">{{ u.revoked ? $t('ai_site.user.unrevoke') : $t('ai_site.user.revoke') }}</button>
        <button class="aibtn danger" @click="removeUser(u)">×</button>
      </div>
    </section>

    <section class="aicard">
      <div class="aihead"><b>{{ $t('ai_site.result.output') }}</b></div>
      <div v-if="!api.plugins.value.length" class="a muted">{{ $t('ai_site.plugins.empty') }}</div>
      <div v-for="p in api.plugins.value" :key="p.name" class="aiplugin">
        <b>{{ p.title }}</b>
        <span class="a muted">{{ p.name }} · {{ p.description }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.aibody { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; overflow: auto; padding: 8px 10px; box-sizing: border-box; }
.aicard { border: 1px solid var(--bd); border-radius: 8px; background: var(--bg3); padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: none; }
.aihead { display: flex; align-items: center; gap: 8px; color: var(--tx1); }
.aihead b { flex: 1; }
.aistat { font-size: 12px; color: var(--tx3); }
.aistat.running { color: #2ecc71; }
.aistat.error { color: #e74c3c; }
.airow { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.airow label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.aigrow { flex: 1; min-width: 260px; }
.aichk { flex-direction: row !important; align-items: center; gap: 6px; }
.aiexp { flex-direction: row !important; align-items: center; gap: 6px; }
.aiexp .aiin { width: auto; }
.aihint { margin: 0; color: var(--tx4); font-size: 12px; }
.abadge { color: var(--err); font-size: 11px; border: 1px solid var(--err); border-radius: 4px; padding: 0 4px; }
.aiin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.aiactions, .aiurl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.aiurl code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--tx3); background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 4px 6px; overflow-wrap: anywhere; }
.aibtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.aibtn.primary { border-color: var(--ac2); color: var(--ac2); }
.aibtn.danger { border-color: var(--err); color: var(--err); }
.aibtn.start { background: #16a34a; border-color: #16a34a; color: #fff; font-weight: 600; font-size: 14px; padding: 8px 22px; border-radius: 8px; }
.aibtn.start:hover { background: #15803d; border-color: #15803d; }
.aimsg { color: var(--ac2); }
.aiuser, .aiplugin { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.aiuser { flex-wrap: wrap; }
.ainame { font-weight: 600; color: var(--tx2); }
.a.muted { color: var(--tx4); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
