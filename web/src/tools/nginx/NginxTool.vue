<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { copyText } from '../../clipboard';
import { useNginx, emptyRule, type CaptureDetail, type CaptureSummary, type NginxLogEntry, type NginxRule } from './useNginx';

const api = useNginx();
const activeId = ref('');
const form = ref<NginxRule>(emptyRule());
const tab = ref<'log' | 'capture'>('log');
const log = ref<NginxLogEntry[]>([]);
const captures = ref<CaptureSummary[]>([]);
const detail = ref<CaptureDetail | null>(null);
const busy = ref(false);
const msg = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const activeStatus = computed(() => (activeId.value ? api.status.value[activeId.value] : null));
const accessUrl = computed(() => {
  const r = api.rules.value.find((x) => x.id === activeId.value);
  if (!r) return '';
  if (r.mode === 'port') return `http://${r.listenHost === '0.0.0.0' ? location.hostname : r.listenHost}:${r.listenPort}/`;
  return `${location.origin}${r.pathPrefix}/`;
});

// 监听地址：单个 host:port 输入（默认 0.0.0.0，用本机真实 IP 访问）
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

const ERROR_KEY: Record<string, string> = { 'port-in-use': 'nginx.err_port_in_use', 'bad-request': 'nginx.err_bad_prefix', 'bad-rewrite': 'nginx.err_bad_rewrite', 'not-found': 'nginx.err_not_found' };
function errText(e: unknown) {
  const c = (e as Error)?.message || '';
  return ERROR_KEY[c] ? t(ERROR_KEY[c]) : c;
}

function toForm(r: NginxRule): NginxRule {
  const f: NginxRule = { ...emptyRule(), ...JSON.parse(JSON.stringify(r)) };
  if (!Array.isArray(f.headers)) f.headers = [];
  if (!Array.isArray(f.rewrites)) f.rewrites = [];
  return f;
}

function selectRule(r: NginxRule) {
  activeId.value = r.id || '';
  form.value = toForm(r);
  detail.value = null;
}
function blankNew() {
  activeId.value = '';
  form.value = emptyRule();
  detail.value = null;
}

async function refresh() {
  if (!activeId.value) return;
  if (tab.value === 'log') log.value = await api.log(activeId.value).catch(() => []);
  else captures.value = await api.captures(activeId.value).catch(() => []);
}

async function doSave() {
  if (!form.value.name.trim()) { msg.value = t('nginx.required_name'); return; }
  busy.value = true; msg.value = '';
  try {
    const saved = await api.save(form.value);
    activeId.value = saved.id || '';
    form.value = toForm(saved);
    msg.value = t('nginx.saved');
  } catch (e) { msg.value = errText(e); } finally { busy.value = false; }
}

async function doDelete() {
  if (!activeId.value) return;
  try { await ElMessageBox.confirm(t('nginx.delete_confirm'), t('nginx.delete'), { type: 'warning' }); } catch { return; }
  try { await api.remove(activeId.value); blankNew(); } catch (e) { msg.value = errText(e); }
}

async function toggle() {
  if (!activeId.value) return;
  const running = activeStatus.value?.status === 'running';
  try {
    if (running) await api.stop(activeId.value); else await api.start(activeId.value);
    const r = api.rules.value.find((x) => x.id === activeId.value);
    if (r) form.value = toForm(r);
  } catch (e) { msg.value = errText(e); }
}

async function openCapture(c: CaptureSummary) {
  detail.value = await api.capture(activeId.value, c.id).catch(() => null);
}

async function clearCaptures() {
  if (!activeId.value) return;
  await api.clearCaptures(activeId.value);
  captures.value = [];
  detail.value = null;
}

function addHeader() { form.value = { ...form.value, headers: [...form.value.headers, { name: '', value: '' }] }; }
function removeHeader(i: number) { form.value = { ...form.value, headers: form.value.headers.filter((_, j) => j !== i) }; }
function addRewrite() { form.value = { ...form.value, rewrites: [...form.value.rewrites, { from: '', to: '' }] }; }
function removeRewrite(i: number) { form.value = { ...form.value, rewrites: form.value.rewrites.filter((_, j) => j !== i) }; }

async function copyUrl() { if (accessUrl.value) { await copyText(accessUrl.value); msg.value = t('nginx.copied'); } }

function tsText(ts: number | string) { return new Date(ts).toLocaleTimeString(); }
function statusText() {
  const s = activeStatus.value;
  if (!s) return '';
  if (s.status === 'error') return s.error || t('nginx.error');
  return s.status === 'running' ? t('nginx.running') : t('nginx.stopped');
}

onMounted(async () => {
  await api.load();
  if (api.rules.value[0]) selectRule(api.rules.value[0]);
  await refresh();
  timer = setInterval(() => { void api.load().then(refresh); }, 2000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="ngbody">
    <div class="ngrules">
      <div class="ngrulelist">
        <button v-for="r in api.rules.value" :key="r.id" class="ngitem" :class="{ on: r.id === activeId }" @click="selectRule(r)">
          <span class="ngdot" :class="(api.status.value[r.id!]?.status) || 'stopped'" />
          <span class="ngname">{{ r.name }}</span>
          <span class="ngmode">{{ r.mode === 'port' ? r.listenHost + ':' + r.listenPort : r.pathPrefix }}</span>
        </button>
        <div v-if="!api.rules.value.length" class="ngempty">{{ $t('nginx.empty') }}</div>
      </div>
      <button class="ngbtn ngnew" @click="blankNew">{{ $t('nginx.new') }}</button>
    </div>

    <div class="ngform">
      <div class="ngrow">
        <label>{{ $t('nginx.name') }}<input v-model="form.name" class="ngin" /></label>
        <label>{{ $t('nginx.mode') }}
          <select v-model="form.mode" class="ngin">
            <option value="port">{{ $t('nginx.mode_port') }}</option>
            <option value="path">{{ $t('nginx.mode_path') }}</option>
          </select>
        </label>
        <label v-if="form.mode === 'port'">{{ $t('nginx.listen') }}<input v-model="listenText" class="ngin" placeholder="0.0.0.0:8081" /></label>
        <label v-else>{{ $t('nginx.path_prefix') }}<input v-model="form.pathPrefix" class="ngin" placeholder="/app1" /></label>
      </div>
      <label v-if="form.mode === 'path'" class="ngchk"><input v-model="form.stripPrefix" type="checkbox" />{{ $t('nginx.strip_prefix') }}</label>

      <div class="nghint">{{ $t('nginx.forward_hint') }}</div>
      <div class="ngrow">
        <label>{{ $t('nginx.protocol') }}
          <select v-model="form.target.protocol" class="ngin">
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </label>
        <label>{{ $t('nginx.host') }}<input v-model="form.target.host" class="ngin" /></label>
        <label>{{ $t('nginx.port') }}<input v-model.number="form.target.port" type="number" class="ngin" /></label>
      </div>
      <div class="ngrow ngchks">
        <label class="ngchk"><input v-model="form.tlsInsecure" type="checkbox" />{{ $t('nginx.tls_insecure') }}</label>
        <label class="ngchk"><input v-model="form.capture" type="checkbox" />{{ $t('nginx.capture') }}</label>
      </div>

      <div class="ngheaders">
        <div class="nghd">{{ $t('nginx.rewrites') }}</div>
        <div class="nghint">{{ $t('nginx.rewrites_hint') }}</div>
        <div v-for="(rw, i) in form.rewrites" :key="i" class="ngrow">
          <input v-model="rw.from" class="ngin" :placeholder="$t('nginx.rewrite_from')" />
          <span class="ngarrow">→</span>
          <input v-model="rw.to" class="ngin" :placeholder="$t('nginx.rewrite_to')" />
          <button class="ngbtn" @click="removeRewrite(i)">×</button>
        </div>
        <button class="ngbtn" @click="addRewrite">{{ $t('nginx.add_rewrite') }}</button>
      </div>

      <div class="ngheaders">
        <div class="nghd">{{ $t('nginx.headers') }}</div>
        <div v-for="(h, i) in form.headers" :key="i" class="ngrow">
          <input v-model="h.name" class="ngin" :placeholder="$t('nginx.header_name')" />
          <input v-model="h.value" class="ngin" :placeholder="$t('nginx.header_value')" />
          <button class="ngbtn" @click="removeHeader(i)">×</button>
        </div>
        <button class="ngbtn" @click="addHeader">{{ $t('nginx.add_header') }}</button>
      </div>

      <div class="ngactions">
        <button class="ngbtn primary" :disabled="busy" @click="doSave">{{ $t('nginx.saved') }}</button>
        <button v-if="activeId" class="ngbtn" @click="toggle">{{ activeStatus?.status === 'running' ? $t('nginx.stop') : $t('nginx.start') }}</button>
        <button v-if="activeId" class="ngbtn" @click="doDelete">{{ $t('nginx.delete') }}</button>
        <span v-if="msg" class="ngmsg">{{ msg }}</span>
      </div>

      <div v-if="activeId" class="ngurl">
        <span>{{ $t('nginx.access_url') }}: <code>{{ accessUrl }}</code></span>
        <button class="ngbtn" @click="copyUrl">{{ $t('nginx.copy') }}</button>
        <span v-if="activeStatus" class="ngstat" :class="activeStatus.status">{{ statusText() }}</span>
      </div>
    </div>

    <div v-if="activeId" class="ngpanels">
      <div class="ngtabs">
        <button class="ngtab" :class="{ on: tab === 'log' }" @click="tab = 'log'; refresh()">{{ $t('nginx.tab_log') }}</button>
        <button class="ngtab" :class="{ on: tab === 'capture' }" @click="tab = 'capture'; refresh()">{{ $t('nginx.tab_capture') }}</button>
        <button v-if="tab === 'capture'" class="ngbtn ngclear" @click="clearCaptures">{{ $t('nginx.clear_captures') }}</button>
      </div>

      <div v-if="tab === 'log'" class="nglog">
        <div v-if="!log.length" class="ngempty">{{ $t('nginx.empty_log') }}</div>
        <div v-for="(e, i) in log" :key="i" class="nglogrow">
          <span class="c-time">{{ tsText(e.ts) }}</span>
          <span class="c-method">{{ e.method }}</span>
          <span class="c-path">{{ e.url }}</span>
          <span class="c-status" :class="{ bad: e.status >= 400 }">{{ e.status }}</span>
          <span class="c-dur">{{ e.durationMs }}ms</span>
        </div>
      </div>

      <div v-else class="ngcap">
        <div class="ngcaplist">
          <div v-if="!captures.length" class="ngempty">{{ $t('nginx.empty_capture') }}</div>
          <button v-for="c in captures" :key="c.id" class="ngcaprow" :class="{ on: detail?.record.id === c.id }" @click="openCapture(c)">
            <span>{{ tsText(c.ts) }}</span>
            <span>{{ c.method }}</span>
            <span class="c-path">{{ c.url }}</span>
            <span>{{ c.status }}</span>
            <span class="c-kind">{{ c.kind }}</span>
            <span v-if="c.state === 'active'" class="c-active">{{ $t('nginx.state_active') }}</span>
            <span v-if="c.truncated" class="c-trunc">{{ $t('nginx.truncated') }}</span>
          </button>
        </div>
        <div v-if="detail" class="ngdet">
          <div class="nghd">{{ $t('nginx.req_headers') }}</div>
          <pre>{{ JSON.stringify(detail.record.reqHeaders, null, 2) }}</pre>
          <div class="nghd">{{ $t('nginx.res_headers') }}</div>
          <pre>{{ JSON.stringify(detail.record.resHeaders, null, 2) }}</pre>
          <template v-if="detail.reqBody"><div class="nghd">{{ $t('nginx.req_body') }}</div><pre>{{ detail.reqBody }}</pre></template>
          <template v-if="detail.resBody">
            <div class="nghd">{{ $t('nginx.res_body') }}<span v-if="detail.record.state === 'active'"> · {{ $t('nginx.streaming') }}</span></div>
            <pre>{{ detail.resBody }}</pre>
          </template>
          <template v-if="detail.frames.length">
            <div class="nghd">{{ $t('nginx.frames') }}</div>
            <div v-for="(f, i) in detail.frames" :key="i" class="ngframe">
              <span>{{ f.dir === 'c2s' ? $t('nginx.dir_c2s') : $t('nginx.dir_s2c') }}</span>
              <code>{{ f.data }}</code>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ngbody { display: flex; flex-direction: column; height: calc(100vh - 150px); gap: 10px; overflow: auto; padding: 4px 2px; }
.ngrules { display: flex; flex-direction: column; gap: 6px; flex: none; }
.ngrulelist { max-height: 200px; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.ngitem { display: flex; align-items: center; gap: 8px; width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--bd); color: var(--tx2); padding: 6px 8px; cursor: pointer; text-align: left; }
.ngitem:last-child { border-bottom: 0; }
.ngitem.on { background: var(--bg2); color: var(--ac2); }
.ngdot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
.ngdot.running { background: #2ecc71; }
.ngdot.error { background: #e74c3c; }
.ngname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ngmode { opacity: .6; font-size: 12px; }
.ngnew { align-self: flex-start; }
.ngempty { padding: 12px; opacity: .6; }
.ngform { display: flex; flex-direction: column; gap: 8px; flex: none; }
.ngrow { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.ngform label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.ngform label.ngchk { flex-direction: row; align-items: center; gap: 6px; }
.ngchks { align-items: center; gap: 16px; }
.nghint { font-size: 12px; color: var(--tx4); }
.ngarrow { color: var(--tx4); }
.ngin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.ngbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ngbtn.primary { border-color: var(--ac2); color: var(--ac2); }
.ngactions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ngmsg { color: var(--ac2); }
.ngurl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ngstat.running { color: #2ecc71; }
.ngstat.error { color: #e74c3c; }
.ngpanels { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.ngtabs { display: flex; gap: 8px; align-items: center; }
.ngtab { background: transparent; border: 0; color: var(--tx2); cursor: pointer; padding: 4px 8px; border-bottom: 2px solid transparent; }
.ngtab.on { color: var(--ac2); border-bottom-color: var(--ac2); }
.ngclear { margin-left: auto; }
.nglog { overflow: auto; }
.nglogrow, .ngcaprow { display: flex; gap: 10px; padding: 3px 6px; font-size: 12px; border-bottom: 1px solid var(--bd); }
.ngcaprow { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--bd); color: var(--tx2); cursor: pointer; text-align: left; }
.ngcaprow.on { background: var(--bg2); }
.c-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-status.bad { color: #e74c3c; }
.c-active { color: #f1c40f; }
.c-trunc { color: #e67e22; }
.ngcap { display: flex; gap: 10px; }
.ngcaplist { width: 50%; max-height: 300px; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; }
.ngdet { width: 50%; max-height: 300px; overflow: auto; }
.ngdet pre { background: var(--bg2); padding: 6px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; }
.nghd { font-weight: 600; margin-top: 6px; }
.ngframe { display: flex; gap: 8px; font-size: 12px; }
</style>
