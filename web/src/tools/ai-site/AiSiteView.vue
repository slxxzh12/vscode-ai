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
    const u = await api.createUser(name);
    newUser.value = '';
    await copyText(u.token);
    msg.value = t('nginx.copied');
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function toggleUser(u: AiSiteUser) {
  try { await api.updateUser(u.id, { enabled: !u.enabled }); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function removeUser(u: AiSiteUser) {
  try { await ElMessageBox.confirm(u.username, t('nginx.delete'), { type: 'warning' }); } catch { return; }
  try { await api.removeUser(u.id); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function copyAccess() { await copyText(accessUrl()); msg.value = t('nginx.copied'); }
function openSite() { window.open(accessUrl(), '_blank', 'noopener'); }
async function copyToken(u: AiSiteUser) { await copyText(u.token); msg.value = t('nginx.copied'); }
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
        <button class="aibtn" :disabled="busy" @click="toggle">{{ api.status.value?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
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
        <button class="aibtn primary" data-action="add-user" @click="addUser">+</button>
      </div>
      <div v-for="u in api.users.value" :key="u.id" class="aiuser">
        <span class="ainame">{{ u.username }}</span>
        <span class="a muted">{{ u.uses }}</span>
        <button class="aibtn" @click="copyToken(u)">{{ $t('nginx.copy') }}</button>
        <label class="aichk"><input type="checkbox" :checked="u.enabled" @change="toggleUser(u)" />{{ u.enabled ? 'on' : 'off' }}</label>
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
.aiin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.aiactions, .aiurl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.aiurl code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--tx3); background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 4px 6px; overflow-wrap: anywhere; }
.aibtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.aibtn.primary { border-color: var(--ac2); color: var(--ac2); }
.aibtn.danger { border-color: var(--err); color: var(--err); }
.aimsg { color: var(--ac2); }
.aiuser, .aiplugin { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.ainame { font-weight: 600; color: var(--tx2); }
.a.muted { color: var(--tx4); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
