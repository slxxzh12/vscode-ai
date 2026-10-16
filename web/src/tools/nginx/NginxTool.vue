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

function selectRule(r: NginxRule) {
  activeId.value = r.id || '';
  form.value = JSON.parse(JSON.stringify(r));
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
    form.value = JSON.parse(JSON.stringify(saved));
    msg.value = t('nginx.saved');
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function doDelete() {
  if (!activeId.value) return;
  try { await ElMessageBox.confirm(t('nginx.delete_confirm'), t('nginx.delete'), { type: 'warning' }); } catch { return; }
  await api.remove(activeId.value);
  blankNew();
}

async function toggle() {
  if (!activeId.value) return;
  const running = activeStatus.value?.status === 'running';
  if (running) await api.stop(activeId.value); else await api.start(activeId.value);
  const r = api.rules.value.find((x) => x.id === activeId.value);
  if (r) form.value = JSON.parse(JSON.stringify(r));
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
    <aside class="nglist">
      <div class="nglisthead">
        <span>{{ $t('tools.nginx') }}</span>
        <button class="ngbtn" @click="blankNew">{{ $t('nginx.new') }}</button>
      </div>
      <div class="ngitems">
        <button v-for="r in api.rules.value" :key="r.id" class="ngitem" :class="{ on: r.id === activeId }" @click="selectRule(r)">
          <span class="ngdot" :class="(api.status.value[r.id!]?.status) || 'stopped'" />
          <span class="ngname">{{ r.name }}</span>
          <span class="ngmode">{{ r.mode === 'port' ? ':' + r.listenPort : r.pathPrefix }}</span>
        </button>
        <div v-if="!api.rules.value.length" class="ngempty">{{ $t('nginx.empty') }}</div>
      </div>
    </aside>

    <section class="ngmain">
      <div class="ngform">
        <label>{{ $t('nginx.name') }}<input v-model="form.name" class="ngin" /></label>
        <div class="ngrow">
          <label>{{ $t('nginx.mode') }}
            <select v-model="form.mode" class="ngin">
              <option value="port">{{ $t('nginx.mode_port') }}</option>
              <option value="path">{{ $t('nginx.mode_path') }}</option>
            </select>
          </label>
          <label>{{ $t('nginx.listen_host') }}
            <select v-model="form.listenHost" class="ngin">
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="0.0.0.0">0.0.0.0</option>
            </select>
          </label>
          <label v-if="form.mode === 'port'">{{ $t('nginx.listen_port') }}<input v-model.number="form.listenPort" type="number" class="ngin" /></label>
          <label v-else>{{ $t('nginx.path_prefix') }}<input v-model="form.pathPrefix" class="ngin" placeholder="/app1" /></label>
        </div>
        <label v-if="form.mode === 'path'" class="ngchk"><input v-model="form.stripPrefix" type="checkbox" />{{ $t('nginx.strip_prefix') }}</label>

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
        <label class="ngchk"><input v-model="form.tlsInsecure" type="checkbox" />{{ $t('nginx.tls_insecure') }}</label>
        <label class="ngchk"><input v-model="form.capture" type="checkbox" />{{ $t('nginx.capture') }}</label>

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
    </section>
  </div>
</template>

<style scoped>
.ngbody { display: flex; height: calc(100vh - 150px); gap: 10px; }
.nglist { width: 220px; flex: none; border-right: 1px solid var(--bd); display: flex; flex-direction: column; }
.nglisthead { display: flex; align-items: center; justify-content: space-between; padding: 6px; }
.ngitems { overflow: auto; }
.ngitem { display: flex; align-items: center; gap: 6px; width: 100%; background: transparent; border: 0; color: var(--tx2); padding: 6px 8px; cursor: pointer; text-align: left; }
.ngitem.on { background: var(--bg2); color: var(--ac2); }
.ngdot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
.ngdot.running { background: #2ecc71; }
.ngdot.error { background: #e74c3c; }
.ngname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ngmode { opacity: .6; font-size: 12px; }
.ngempty { padding: 12px; opacity: .6; }
.ngmain { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.ngrow { display: flex; gap: 10px; align-items: flex-end; }
.ngform label, .ngchk { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--tx2); }
.ngchk { flex-direction: row; align-items: center; gap: 6px; }
.ngin { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 6px; }
.ngbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ngbtn.primary { border-color: var(--ac2); color: var(--ac2); }
.ngactions { display: flex; gap: 8px; align-items: center; }
.ngmsg { color: var(--ac2); }
.ngurl { display: flex; gap: 8px; align-items: center; }
.ngstat.running { color: #2ecc71; }
.ngstat.error { color: #e74c3c; }
.ngtabs { display: flex; gap: 8px; align-items: center; }
.ngtab { background: transparent; border: 0; color: var(--tx2); cursor: pointer; padding: 4px 8px; border-bottom: 2px solid transparent; }
.ngtab.on { color: var(--ac2); border-bottom-color: var(--ac2); }
.ngclear { margin-left: auto; }
.nglogrow, .ngcaprow { display: flex; gap: 10px; padding: 3px 6px; font-size: 12px; border-bottom: 1px solid var(--bd); }
.ngcaprow { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--bd); color: var(--tx2); cursor: pointer; text-align: left; }
.ngcaprow.on { background: var(--bg2); }
.c-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-status.bad { color: #e74c3c; }
.c-active { color: #f1c40f; }
.c-trunc { color: #e67e22; }
.ngcap { display: flex; gap: 10px; }
.ngcaplist { width: 50%; max-height: 340px; overflow: auto; }
.ngdet { width: 50%; max-height: 340px; overflow: auto; }
.ngdet pre { background: var(--bg2); padding: 6px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; }
.nghd { font-weight: 600; margin-top: 6px; }
.ngframe { display: flex; gap: 8px; font-size: 12px; }
</style>
