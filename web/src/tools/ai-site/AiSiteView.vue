<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { pickErrorText } from '../../pickFolder';
import { copyText } from '../../clipboard';
import AiRunView from '../../ai-run/AiRunView.vue';
import { useAiSite, type AiSiteConfig, type AiSiteUser, type AiSitePlugin } from './useAiSite';

const api = useAiSite();
const form = ref<AiSiteConfig | null>(null);
const msg = ref('');
const busy = ref(false);
const newUser = ref('');
const newExpiry = ref(defaultExpiry());
interface PluginTab { name: string; plugin: AiSitePlugin; values: Record<string, any>; busy: boolean; msg: string }
interface RunTab { name: string; runId: string; label: string }
const mainTab = ref('main');
const pluginTabs = ref<PluginTab[]>([]);
const runTabs = ref<RunTab[]>([]);

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
function normPath(p: string | undefined): string {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function samePath(a: string | undefined, b: string | undefined): boolean {
  const x = normPath(a);
  return !!x && x === normPath(b);
}

const running = computed(() => api.status.value?.status === 'running');
const statusType = computed(() => {
  const s = api.status.value?.status;
  return s === 'running' ? 'success' : s === 'error' ? 'danger' : 'info';
});
const statusText = computed(() => {
  const s = api.status.value?.status;
  if (s === 'running') return t('nginx.running');
  if (s === 'error') return api.status.value?.error || t('nginx.error');
  return t('nginx.stopped');
});
const usingDefault = computed(() => {
  const f = form.value;
  if (!f) return false;
  return !!f.pluginRootDefault || samePath(f.pluginRoot, f.pluginRootDefaultPath);
});

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
    if (r.error) { msg.value = pickErrorText(r); return; }
    if (r.cancelled || !r.path || !form.value) return;
    form.value = { ...form.value, pluginRoot: r.path, pluginRootDefault: false };
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

function useDefaultDir() {
  if (!form.value) return;
  form.value = { ...form.value, pluginRoot: form.value.pluginRootDefaultPath || '', pluginRootDefault: true };
}

async function doSave() {
  if (!form.value) return;
  busy.value = true; msg.value = '';
  try {
    const { pluginRootDefault: _pd, pluginRootDefaultPath: _pp, ...payload } = form.value;
    const saved = await api.save(payload);
    form.value = { ...saved };
    ElMessage.success(t('nginx.saved_ok'));
  } catch (e) { msg.value = String((e as Error)?.message || e); } finally { busy.value = false; }
}

async function toggle() {
  busy.value = true;
  try {
    if (running.value) await api.stop(); else await api.start();
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
    ElMessage.success(t('nginx.copied'));
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function toggleUser(u: AiSiteUser) {
  try { await api.updateUser(u.id, { enabled: !u.enabled }); } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function onExpiryChange(u: AiSiteUser, value: any) {
  try { await api.updateUser(u.id, { expiresAt: dateToExp(String(value || '')) }); } catch (e) { msg.value = String((e as Error)?.message || e); }
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

async function copyAccess() { await copyText(accessUrl()); ElMessage.success(t('nginx.copied')); }
function openSite() { window.open(accessUrl(), '_blank', 'noopener'); }
async function copyToken(u: AiSiteUser) { await copyText(u.jwt); ElMessage.success(t('nginx.copied')); }

function openPlugin(p: AiSitePlugin) {
  if (p.error) return;
  const name = `p:${p.name}`;
  if (!pluginTabs.value.some((x) => x.name === name)) {
    const values: Record<string, any> = {};
    for (const f of p.fields || []) {
      if (f.type === 'checkbox') values[f.key] = f.default === 'true';
      else if (f.type === 'number') values[f.key] = f.default !== undefined && f.default !== '' ? Number(f.default) : undefined;
      else values[f.key] = f.default ?? '';
    }
    pluginTabs.value.push({ name, plugin: p, values, busy: false, msg: '' });
  }
  mainTab.value = name;
}

async function submitPlugin(tab: PluginTab) {
  const p = tab.plugin;
  const missing = (p.fields || []).filter((f) => f.required && !String(tab.values[f.key] ?? '').trim());
  if (missing.length) {
    ElMessage.warning(t('ai_site.required', { name: missing.map((f) => f.label).join(', ') }));
    return;
  }
  tab.busy = true;
  tab.msg = '';
  try {
    const values: Record<string, string> = {};
    for (const f of p.fields || []) {
      if (f.type === 'checkbox') { if (tab.values[f.key]) values[f.key] = '1'; }
      else values[f.key] = String(tab.values[f.key] ?? '');
    }
    const r = await fetch('/api/ai-site/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: p.name, values }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    const name = `r:${j.runId}`;
    if (!runTabs.value.some((x) => x.name === name)) {
      runTabs.value.push({ name, runId: j.runId, label: `${p.title} · ${t('ai_site.run.title')}` });
    }
    mainTab.value = name;
  } catch (e) {
    tab.msg = String((e as Error)?.message || e);
  } finally {
    tab.busy = false;
  }
}

function closeTab(name: string | number) {
  const key = String(name);
  pluginTabs.value = pluginTabs.value.filter((x) => x.name !== key);
  runTabs.value = runTabs.value.filter((x) => x.name !== key);
  if (mainTab.value === key) mainTab.value = 'main';
}
</script>

<template>
  <div v-if="form" class="aibody-wrap">
    <el-tabs v-model="mainTab" type="border-card" class="aitabs" @tab-remove="closeTab">
      <el-tab-pane name="main" :closable="false" :label="$t('ai_site.title')">
        <div class="aibody">
    <el-card shadow="never" class="aicard config">
      <template #header>
        <div class="head">
          <div class="title">
            <span class="dot" :class="api.status.value?.status" />
            <span>{{ $t('ai_site.title') }}</span>
            <el-tag size="small" :type="statusType" effect="plain">{{ statusText }}</el-tag>
          </div>
          <el-button :type="running ? 'danger' : 'success'" size="small" :loading="busy" @click="toggle">
            {{ running ? $t('nginx.stop') : $t('nginx.start') }}
          </el-button>
        </div>
      </template>

      <el-form label-position="top" class="aiform">
        <el-form-item :label="$t('static_site.root_dir')">
          <div class="dirrow">
            <el-input
              v-model="form.pluginRoot"
              data-field="plugin-root"
              :placeholder="form.pluginRootDefaultPath || $t('nginx.static_dir_ph')"
              clearable
            />
            <el-button size="small" @click="pickDir">{{ $t('nginx.pick_dir') }}</el-button>
            <el-button size="small" @click="useDefaultDir">{{ $t('ai_site.use_default_dir') }}</el-button>
            <el-tag v-if="usingDefault" type="success" effect="plain">{{ $t('ai_site.default_dir') }}</el-tag>
          </div>
          <div class="hint">{{ $t('ai_site.default_dir_hint') }}</div>
        </el-form-item>

        <div class="grid3">
          <el-form-item :label="$t('nginx.mode')">
            <el-select v-model="form.mode" data-field="mode">
              <el-option value="port" :label="$t('nginx.mode_port')" />
              <el-option value="path" :label="$t('nginx.mode_path')" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.mode === 'port'" :label="$t('nginx.listen')">
            <el-input-number v-model="form.listenPort" data-field="listen-port" :min="1" :max="65535" controls-position="right" />
          </el-form-item>
          <el-form-item v-else :label="$t('nginx.path_prefix')">
            <el-input v-model="form.pathPrefix" data-field="path-prefix" placeholder="/ai" />
          </el-form-item>
          <el-form-item :label="$t('ai_site.login.title')">
            <el-switch v-model="form.requireAuth" data-field="require-auth" />
          </el-form-item>
        </div>

        <div class="actions">
          <el-button type="primary" size="small" :loading="busy" @click="doSave">{{ $t('nginx.saved') }}</el-button>
          <span v-if="msg" class="msg">{{ msg }}</span>
        </div>

        <el-form-item :label="$t('nginx.access_url')">
          <div class="urlrow">
            <el-input :model-value="accessUrl()" readonly class="urlinput" :title="accessUrl()" />
            <el-button size="small" @click="copyAccess">{{ $t('nginx.copy') }}</el-button>
            <el-button size="small" @click="openSite">{{ $t('static_site.open') }}</el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="aicard users">
      <template #header>
        <div class="title">{{ $t('ai_site.login.title') }}</div>
      </template>
      <div class="adduser">
        <el-input v-model="newUser" data-field="new-user" class="newuser" :placeholder="$t('ai_site.login.username')" />
        <span data-field="new-expiry" class="expwrap">
          <el-date-picker
            v-model="newExpiry"
            type="date"
            value-format="YYYY-MM-DD"
            :placeholder="$t('ai_site.user.expires')"
          />
        </span>
        <el-button type="primary" size="small" data-action="add-user" @click="addUser">{{ $t('ai_site.user.add') }}</el-button>
      </div>
      <div class="hint">{{ $t('ai_site.user.jwt_hint') }}</div>

      <el-table :data="api.users.value" size="small" class="usertable" :empty-text="$t('ai_site.plugins.empty')">
        <el-table-column :label="$t('ai_site.login.username')" prop="username" min-width="120" />
        <el-table-column :label="$t('ai_site.user.status')" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.revoked" type="danger" size="small">{{ $t('ai_site.user.revoked') }}</el-tag>
            <el-tag v-else-if="isExpired(row)" type="warning" size="small">{{ $t('ai_site.user.expired') }}</el-tag>
            <el-tag v-else :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? 'on' : 'off' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('ai_site.user.uses')" prop="uses" width="90" align="center" />
        <el-table-column :label="$t('ai_site.user.expires')" width="160">
          <template #default="{ row }">
            <el-date-picker
              :model-value="expToDate(row.exp)"
              type="date"
              value-format="YYYY-MM-DD"
              size="small"
              class="expdate"
              @change="(v: any) => onExpiryChange(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="$t('ai_site.user.actions')" min-width="260">
          <template #default="{ row }">
            <el-button size="small" text type="primary" data-action="copy-jwt" @click="copyToken(row)">{{ $t('ai_site.user.copy_jwt') }}</el-button>
            <el-switch :model-value="row.enabled" size="small" @change="() => toggleUser(row)" />
            <el-button size="small" text :type="row.revoked ? 'success' : 'warning'" @click="toggleRevoke(row)">
              {{ row.revoked ? $t('ai_site.user.unrevoke') : $t('ai_site.user.revoke') }}
            </el-button>
            <el-button size="small" text type="danger" @click="removeUser(row)">×</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="aicard plugins">
      <template #header>
        <div class="title">{{ $t('ai_site.result.output') }}</div>
      </template>
      <el-table :data="api.plugins.value" size="small" :empty-text="$t('ai_site.plugins.empty')">
        <el-table-column :label="$t('ai_site.plugin.title')" prop="title" min-width="140" />
        <el-table-column :label="$t('ai_site.plugin.id')" prop="name" width="150" />
        <el-table-column :label="$t('ai_site.plugin.description')" prop="description" min-width="240" show-overflow-tooltip />
        <el-table-column :label="$t('ai_site.plugin.status')" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.error" type="danger" size="small">{{ $t('ai_site.plugins.bad') }}</el-tag>
            <el-tag v-else type="success" size="small">{{ $t('ai_site.plugin.ok') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('ai_site.result.actions')" width="90" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="!!row.error" @click="openPlugin(row)">{{ $t('ai_site.form.run') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

        </div>
      </el-tab-pane>

      <el-tab-pane v-for="tab in pluginTabs" :key="tab.name" :name="tab.name" :label="tab.plugin.title" closable>
        <div class="pluginform">
          <el-form label-position="top" class="runform">
            <el-form-item v-for="f in tab.plugin.fields || []" :key="f.key" :label="f.label + (f.required ? ' *' : '')">
              <el-select v-if="f.type === 'select'" v-model="tab.values[f.key]" style="width: 100%">
                <el-option v-for="o in f.options || []" :key="o" :label="o" :value="o" />
              </el-select>
              <el-input v-else-if="f.type === 'textarea'" v-model="tab.values[f.key]" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :placeholder="f.placeholder || ''" />
              <el-input-number v-else-if="f.type === 'number'" v-model="tab.values[f.key]" :min="f.min" :max="f.max" :step="f.step" controls-position="right" style="width: 100%" />
              <el-switch v-else-if="f.type === 'checkbox'" v-model="tab.values[f.key]" />
              <el-date-picker v-else-if="f.type === 'date'" v-model="tab.values[f.key]" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
              <el-input v-else v-model="tab.values[f.key]" :type="f.type === 'password' ? 'password' : 'text'" :placeholder="f.placeholder || ''" />
            </el-form-item>
            <el-empty v-if="!(tab.plugin.fields || []).length" :description="$t('ai_site.form.fields_hint')" :image-size="60" />
          </el-form>
          <div class="pluginform-actions">
            <el-button size="small" type="primary" :loading="tab.busy" @click="submitPlugin(tab)">{{ $t('ai_site.form.run') }}</el-button>
          </div>
          <div v-if="tab.msg" class="msg">{{ tab.msg }}</div>
        </div>
      </el-tab-pane>

      <el-tab-pane v-for="run in runTabs" :key="run.name" :name="run.name" :label="run.label" closable>
        <AiRunView :run-id="run.runId" api-root="/api/ai-site" :show-back="false" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.aibody-wrap { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.aitabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.aitabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: auto; }
.aitabs :deep(.el-tab-pane) { height: 100%; }
.pluginform { padding: 4px 2px; }
.pluginform-actions { margin-top: 10px; }
.aibody { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px; height: 100%; min-height: 0; overflow: auto; padding: 6px 8px; box-sizing: border-box; align-content: start; }
.aicard { min-width: 0; }
.aicard.config { grid-column: 1 / -1; }
.aicard.users, .aicard.plugins { min-height: 0; height: 100%; display: flex; flex-direction: column; }
.aicard.users :deep(.el-card__body), .aicard.plugins :deep(.el-card__body) { flex: 1; min-height: 0; overflow: auto; }
.aicard :deep(.el-card__header) { padding: 5px 10px; }
.aicard :deep(.el-card__body) { padding: 8px 10px; }
.head { display: flex; align-items: center; gap: 10px; }
.title { display: flex; align-items: center; gap: 8px; flex: 1; font-weight: 600; color: var(--tx1); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--tx4); flex: none; }
.dot.running { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, .18); }
.dot.error { background: #ef4444; }
.aiform { display: flex; flex-direction: column; gap: 2px; }
.aiform :deep(.el-form-item) { margin-bottom: 8px; }
.dirrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%; }
.dirrow .el-input { flex: 1; min-width: 260px; }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 12px; }
.actions { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
.msg { color: var(--err); font-size: 12px; }
.urlinput { width: 100%; }
.urlrow { display: flex; gap: 8px; align-items: center; width: 100%; max-width: 460px; }
.urlrow .urlinput { flex: 1; min-width: 0; }
.urlrow .el-button + .el-button { margin-left: 0; }
.adduser { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.newuser { width: 180px; }
.expwrap { display: inline-flex; }
.hint { color: var(--tx4); font-size: 12px; line-height: 1.6; margin: 0 0 8px; }
.usertable { width: 100%; }
.expdate { width: 140px; }
.runform :deep(.el-form-item) { margin-bottom: 8px; }
@media (max-width: 1100px) {
  .aibody { grid-template-columns: 1fr; grid-template-rows: auto; }
  .aicard.config { grid-column: auto; }
  .aicard.users, .aicard.plugins { height: auto; }
}
</style>
