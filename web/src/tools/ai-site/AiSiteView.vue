<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
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
    if (r.error) { msg.value = r.error === 'unsupported' ? t('nginx.pick_unsupported') : t('nginx.pick_failed', { msg: r.message || r.error }); return; }
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
</script>

<template>
  <div v-if="form" class="aibody">
    <el-card shadow="never" class="aicard">
      <template #header>
        <div class="head">
          <div class="title">
            <span class="dot" :class="api.status.value?.status" />
            <span>{{ $t('ai_site.title') }}</span>
            <el-tag size="small" :type="statusType" effect="plain">{{ statusText }}</el-tag>
          </div>
          <el-button :type="running ? 'danger' : 'success'" size="large" :loading="busy" @click="toggle">
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
            <el-button @click="pickDir">{{ $t('nginx.pick_dir') }}</el-button>
            <el-button @click="useDefaultDir">{{ $t('ai_site.use_default_dir') }}</el-button>
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
          <el-button type="primary" :loading="busy" @click="doSave">{{ $t('nginx.saved') }}</el-button>
          <span v-if="msg" class="msg">{{ msg }}</span>
        </div>

        <el-form-item :label="$t('nginx.access_url')">
          <el-input :model-value="accessUrl()" readonly class="urlinput">
            <template #append>
              <el-button @click="copyAccess">{{ $t('nginx.copy') }}</el-button>
              <el-button @click="openSite">{{ $t('static_site.open') }}</el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="aicard">
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
        <el-button type="primary" data-action="add-user" @click="addUser">{{ $t('ai_site.user.add') }}</el-button>
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

    <el-card shadow="never" class="aicard">
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
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.aibody { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; overflow: auto; padding: 10px 12px; box-sizing: border-box; }
.aicard { flex: none; }
.head { display: flex; align-items: center; gap: 12px; }
.title { display: flex; align-items: center; gap: 8px; flex: 1; font-weight: 600; color: var(--tx1); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--tx4); flex: none; }
.dot.running { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, .18); }
.dot.error { background: #ef4444; }
.aiform { display: flex; flex-direction: column; gap: 4px; }
.dirrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%; }
.dirrow .el-input { flex: 1; min-width: 260px; }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 16px; }
.actions { display: flex; align-items: center; gap: 10px; margin: 2px 0 14px; }
.msg { color: var(--err); font-size: 12px; }
.urlinput { width: 100%; }
.adduser { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.newuser { width: 220px; }
.expwrap { display: inline-flex; }
.hint { color: var(--tx4); font-size: 12px; line-height: 1.6; margin: 2px 0 10px; }
.usertable { width: 100%; }
.expdate { width: 140px; }
</style>
