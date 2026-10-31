<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { copyText } from '../../clipboard';
import {
  emptyRule, type NginxApi, type NginxRule, type NginxStatus,
} from './useNginx';
import { nginxErrText } from './errors';

const props = defineProps<{
  rule: NginxRule;
  api: NginxApi;
  status?: NginxStatus | null;
  highlight?: boolean;
  draft?: boolean;
}>();
const emit = defineEmits<{ (e: 'saved', rule: NginxRule): void; (e: 'deleted'): void }>();

const root = ref<HTMLElement | null>(null);
const id = ref(props.rule.id || '');
const form = ref<NginxRule>(toForm(props.rule));
const collapsed = ref(false);
const busy = ref(false);
const msg = ref('');

const activeStatus = computed(() => props.status ?? null);
const sitePrefixOf = computed(() => {
  const s = String(props.rule.sitePrefix || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return s ? `/${s}` : '';
});
const accessUrl = computed(() => {
  const r = props.rule;
  if (!r.id) return '';
  const base = r.mode === 'port'
    ? `http://${r.listenHost === '0.0.0.0' ? location.hostname : r.listenHost}:${r.listenPort}`
    : `${location.origin}${r.pathPrefix}`;
  return `${base}${sitePrefixOf.value}/`;
});
const listenText = computed({
  get: () => `${form.value.listenHost}:${form.value.listenPort}`,
  set: (v: string) => {
    const s = String(v || '').trim();
    const i = s.lastIndexOf(':');
    if (i < 0) {
      const p = Number(s);
      if (Number.isInteger(p) && p > 0 && p <= 65535) form.value = { ...form.value, listenPort: p };
      return;
    }
    const host = s.slice(0, i).trim() || '0.0.0.0';
    const p = Number(s.slice(i + 1).trim());
    form.value = {
      ...form.value,
      listenHost: host as NginxRule['listenHost'],
      listenPort: Number.isInteger(p) && p > 0 && p <= 65535 ? p : form.value.listenPort,
    };
  },
});

function toForm(r: NginxRule): NginxRule {
  const f = { ...emptyRule(), ...r } as NginxRule;
  if (r.spaFallback === undefined) f.spaFallback = true;
  return JSON.parse(JSON.stringify(f)) as NginxRule;
}

watch(() => form.value.mode, (mode) => {
  if (mode === 'path' && !form.value.pathPrefix) form.value = { ...form.value, pathPrefix: '/site' };
  if (mode === 'port' && !form.value.listenPort) form.value = { ...form.value, listenPort: emptyRule().listenPort };
});

function scrollIntoView() {
  if (!props.highlight) return;
  void nextTick(() => root.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
}
onMounted(scrollIntoView);
watch(() => props.highlight, (v) => {
  if (!v) return;
  collapsed.value = false;
  scrollIntoView();
});

async function pickDir() {
  msg.value = '';
  try {
    const r = await props.api.pickFolder();
    if (r.error) { msg.value = r.error === 'unsupported' ? t('nginx.pick_unsupported') : t('nginx.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path) return;
    form.value = { ...form.value, staticDir: r.path };
  } catch (e) { msg.value = String((e as Error)?.message || e); }
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nginx.required_name'); return; }
  if (!form.value.staticDir) { msg.value = t('static_site.pick_first'); return; }
  busy.value = true; msg.value = '';
  try {
    const payload = { ...form.value };
    if (!payload.id) payload.enabled = true;
    const saved = await props.api.save(payload);
    id.value = saved.id || '';
    form.value = toForm(saved);
    msg.value = t('nginx.saved_ok');
    emit('saved', saved);
  } catch (e) { msg.value = nginxErrText(e); } finally { busy.value = false; }
}

async function doDelete() {
  if (!id.value) { emit('deleted'); return; }
  try { await ElMessageBox.confirm(t('nginx.delete_confirm'), t('nginx.delete'), { type: 'warning' }); } catch { return; }
  try {
    await props.api.remove(id.value);
    emit('deleted');
  } catch (e) { msg.value = nginxErrText(e); }
}

async function toggle() {
  if (!id.value) return;
  const running = activeStatus.value?.status === 'running';
  try {
    if (running) await props.api.stop(id.value); else await props.api.start(id.value);
  } catch (e) { msg.value = nginxErrText(e); }
}

async function copyUrl() { if (accessUrl.value) { await copyText(accessUrl.value); msg.value = t('nginx.copied'); } }
function openSite() { if (accessUrl.value) window.open(accessUrl.value, '_blank', 'noopener'); }

function uiLink(): string {
  const u = new URL(location.href);
  if (id.value) u.searchParams.set('rule', id.value); else u.searchParams.delete('rule');
  u.hash = '#proxy/static';
  return u.toString();
}
async function copyLink() {
  if (!id.value) return;
  await copyText(uiLink());
  msg.value = t('nginx.copied');
}

function statusText() {
  const s = activeStatus.value;
  if (!s) return '';
  if (s.status === 'error') return s.error || t('nginx.error');
  return s.status === 'running' ? t('nginx.running') : t('nginx.stopped');
}
</script>

<template>
  <section ref="root" class="sscard" :class="{ hl: highlight }" :data-rule-id="id || undefined">
    <div class="sshead" @click="collapsed = !collapsed">
      <span class="ssdot" :class="activeStatus?.status || 'stopped'" />
      <span class="ssname">{{ form.name || $t('static_site.default_name') }}</span>
      <span class="ssmode">{{ form.mode === 'port' ? form.listenHost + ':' + form.listenPort : form.pathPrefix }}</span>
      <span v-if="activeStatus" class="ssstat" :class="activeStatus.status">{{ statusText() }}</span>
      <button v-if="id" class="ssbtn" @click.stop="toggle">{{ activeStatus?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
      <span class="sschev" :title="collapsed ? $t('nginx.expand') : $t('nginx.collapse')">{{ collapsed ? '▸' : '▾' }}</span>
    </div>

    <div v-if="!collapsed" class="sscard-body">
      <div class="ssrow">
        <label>{{ $t('nginx.name') }}<input v-model="form.name" class="ssin" data-field="name" /></label>
        <label>{{ $t('nginx.mode') }}
          <select v-model="form.mode" class="ssin" data-field="mode">
            <option value="port">{{ $t('nginx.mode_port') }}</option>
            <option value="path">{{ $t('nginx.mode_path') }}</option>
          </select>
        </label>
        <label v-if="form.mode === 'port'">{{ $t('nginx.listen') }}<input v-model="listenText" class="ssin" data-field="listen" placeholder="0.0.0.0:8080" /></label>
        <label v-else>{{ $t('nginx.path_prefix') }}<input v-model="form.pathPrefix" class="ssin" data-field="path-prefix" placeholder="/site" /></label>
      </div>

      <div class="ssrow">
        <label>{{ $t('static_site.prefix') }}<input v-model="form.sitePrefix" class="ssin" data-field="site-prefix" :placeholder="$t('static_site.prefix_ph')" /></label>
      </div>
      <div class="sshint">{{ $t('static_site.prefix_hint') }}</div>

      <div class="ssrow">
        <label class="ssdir">{{ $t('static_site.root_dir') }}<input v-model="form.staticDir" class="ssin" data-field="static-dir" :placeholder="$t('nginx.static_dir_ph')" /></label>
        <button class="ssbtn" @click="pickDir">{{ $t('nginx.pick_dir') }}</button>
        <button v-if="form.staticDir" class="ssbtn" @click="form.staticDir = ''">{{ $t('nginx.clear_dir') }}</button>
      </div>
      <div class="sshint">{{ $t('static_site.root_hint') }}</div>
      <label class="sschk"><input v-model="form.spaFallback" type="checkbox" data-field="spa-fallback" />{{ $t('static_site.spa') }}</label>
      <div class="sshint">{{ $t('static_site.spa_hint') }}</div>
      <label class="sschk"><input v-model="form.showTree" type="checkbox" data-field="show-tree" />{{ $t('static_site.show_tree') }}</label>
      <div class="sshint">{{ $t('static_site.show_tree_hint') }}</div>

      <div class="ssactions">
        <button class="ssbtn primary" :disabled="busy" @click="doSave">{{ $t('nginx.saved') }}</button>
        <button v-if="id" class="ssbtn" @click="toggle">{{ activeStatus?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
        <button class="ssbtn" @click="doDelete">{{ $t('nginx.delete') }}</button>
        <span v-if="msg" class="ssmsg">{{ msg }}</span>
      </div>

      <div v-if="id" class="ssurl">
        <span>{{ $t('nginx.access_url') }}: <code>{{ accessUrl }}</code></span>
        <button class="ssbtn" @click="copyUrl">{{ $t('nginx.copy') }}</button>
        <button class="ssbtn" @click="openSite">{{ $t('static_site.open') }}</button>
        <button class="ssbtn" @click="copyLink">{{ $t('nginx.copy_link') }}</button>
        <span v-if="activeStatus" class="ssstat" :class="activeStatus.status">{{ statusText() }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sscard { border: 1px solid var(--bd); border-radius: 8px; background: var(--bg3); flex: none; }
.sscard.hl { border-color: var(--ac2); }
.sscard-body { display: flex; flex-direction: column; gap: 8px; padding: 0 10px 10px; }
.sshead { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; color: var(--tx2); }
.sshead:hover { color: var(--ac2); }
.ssdot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
.ssdot.running { background: #2ecc71; }
.ssdot.error { background: #e74c3c; }
.ssname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ssmode { opacity: .6; font-size: 12px; }
.sschev { flex: none; color: var(--tx4); width: 14px; text-align: center; }
.ssrow { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.sscard-body label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.ssdir { flex: 1; min-width: 260px; }
.sschk { flex-direction: row !important; align-items: center; gap: 6px; }
.ssin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.sshint { font-size: 12px; color: var(--tx4); }
.ssbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ssbtn.primary { border-color: var(--ac2); color: var(--ac2); }
.ssactions, .ssurl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ssurl code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--tx3); background: var(--bg2); border: 1px solid var(--bd); border-radius: 6px; padding: 4px 6px; overflow-wrap: anywhere; }
.ssstat.running { color: #2ecc71; }
.ssstat.error { color: #e74c3c; }
.ssmsg { color: var(--ac2); }
</style>
