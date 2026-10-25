<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import { ElMessageBox } from 'element-plus';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { t } from '../i18n';
import { useTheme } from '../theme';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface RemoteState { enabled: boolean; expiresAt: number | null; forever?: boolean; address?: string | null; needRestart?: boolean; local?: boolean }
interface RemoteUser { id: string; username: string; token: string; enabled: boolean; createdAt: number; updatedAt: number; lastLoginAt: number }
interface StatUser { userId: string; userName: string; messages: number; chars: number; sessions: number; firstTs: number; lastTs: number }
interface StatSession { userId: string; userName: string; projectId: string; sessionId: string; tabName: string; messages: number; chars: number; firstTs: number; lastTs: number }
interface StatMonth { userId: string; userName: string; month: string; messages: number; chars: number }
interface StatDay { userId: string; userName: string; day: string; messages: number; chars: number }
interface Stats { totals: { messages: number; chars: number; sessions: number; users: number }; users: StatUser[]; sessions: StatSession[]; months: StatMonth[]; days: StatDay[] }

const EMPTY: Stats = { totals: { messages: 0, chars: 0, sessions: 0, users: 0 }, users: [], sessions: [], months: [], days: [] };
const { isDark } = useTheme();
const state = ref<RemoteState>({ enabled: false, expiresAt: null });
const users = ref<RemoteUser[]>([]);
const stats = ref<Stats>(EMPTY);
const loading = ref(false);
const err = ref('');
const userMsg = ref('');
const newUserName = ref('');
const newUserToken = ref('');
const metric = ref<'messages' | 'chars'>('messages');
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

const USER_ERR: Record<string, string> = {
  'bad-username': 'remote.err_bad_username',
  'bad-token': 'remote.err_bad_token',
  'duplicate-username': 'remote.err_duplicate_username',
  'duplicate-token': 'remote.err_duplicate_token',
};
function userErr(code: string) { return USER_ERR[code] ? t(USER_ERR[code]) : code; }

async function load() {
  loading.value = true; err.value = '';
  try {
    const [st, us, ss] = await Promise.all([
      fetch('/api/remote/state').then((x) => x.json()),
      fetch('/api/remote/users').then((x) => x.json()),
      fetch('/api/master/stats').then((x) => x.json()),
    ]);
    state.value = st || { enabled: false, expiresAt: null };
    users.value = Array.isArray(us.items) ? us.items : [];
    stats.value = ss.stats || EMPTY;
    await nextTick();
    draw();
  } catch (e) { err.value = t('master.failed', { msg: (e as Error)?.message || String(e) }); }
  finally { loading.value = false; }
}

function fmtTime(ts: number) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}
function nameOf(userId: string, fallback = '') {
  if (!userId) return fallback || t('master.host_user');
  const u = stats.value.users.find((x) => x.userId === userId);
  return u?.userName || fallback || userId;
}
function sessionLabel(s: StatSession) {
  return s.tabName || s.sessionId || t('master.unbound_session');
}
function projectLabel(projectId: string) { return projectId || t('master.unbound_project'); }

const monthList = computed(() => {
  const set = new Set(stats.value.months.map((m) => m.month).filter(Boolean));
  return [...set].sort().reverse().slice(0, 12);
});
const monthMap = computed(() => {
  const m = new Map<string, StatMonth>();
  for (const x of stats.value.months) m.set(`${x.userId}|${x.month}`, x);
  return m;
});
function monthCell(userId: string, month: string) { return monthMap.value.get(`${userId}|${month}`); }
const monthlyUsers = computed(() => stats.value.users.filter((u) => u.messages > 0));

const chartDays = computed(() => {
  const set = new Set(stats.value.days.map((d) => d.day).filter(Boolean));
  return [...set].sort().slice(-30);
});
const chartSeries = computed(() => {
  const byUser = new Map<string, Map<string, number>>();
  for (const d of stats.value.days) {
    if (!d.day) continue;
    if (!byUser.has(d.userId)) byUser.set(d.userId, new Map());
    byUser.get(d.userId)!.set(d.day, Number(d[metric.value]) || 0);
  }
  return [...byUser.entries()].map(([userId, map]) => ({
    name: nameOf(userId),
    type: 'line' as const,
    smooth: true,
    symbolSize: 4,
    data: chartDays.value.map((day) => (map.has(day) ? map.get(day)! : null)),
  }));
});

function draw() {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value, isDark.value ? 'dark' : null);
  const axis = isDark.value ? '#8b96a5' : '#6b7280';
  const split = isDark.value ? '#2a323e' : '#e5e7eb';
  chart.setOption({
    grid: { left: 46, right: 16, top: 30, bottom: 26 },
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', right: 0, top: 0, textStyle: { color: axis, fontSize: 11 } },
    xAxis: { type: 'category', data: chartDays.value, axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: split } } },
    yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: split } } },
    series: chartSeries.value,
  }, true);
  chart.resize();
}

async function addUser() {
  userMsg.value = '';
  try {
    const r = await fetch('/api/remote/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUserName.value, token: newUserToken.value || undefined }),
    }).then((x) => x.json());
    if (r.error) { userMsg.value = userErr(r.error); return; }
    newUserName.value = ''; newUserToken.value = '';
    await load();
  } catch (e) { userMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
async function toggleUser(u: RemoteUser) {
  userMsg.value = '';
  try {
    const r = await fetch(`/api/remote/users?id=${encodeURIComponent(u.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !u.enabled }),
    }).then((x) => x.json());
    if (r.error) { userMsg.value = userErr(r.error); return; }
    await load();
  } catch (e) { userMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
async function delUser(u: RemoteUser) {
  try { await ElMessageBox.confirm(t('remote.user_delete_confirm', { name: u.username }), t('remote.users_title'), { type: 'warning' }); } catch { return; }
  userMsg.value = '';
  try {
    const r = await fetch(`/api/remote/users?id=${encodeURIComponent(u.id)}`, { method: 'DELETE' }).then((x) => x.json());
    if (!r.ok) { userMsg.value = userErr(r.error || 'not-found'); return; }
    await load();
  } catch (e) { userMsg.value = t('remote.failed', { msg: (e as Error)?.message || String(e) }); }
}
async function copy(v: string) {
  try { await navigator.clipboard.writeText(v); userMsg.value = t('remote.copied'); setTimeout(() => { userMsg.value = ''; }, 1500); } catch { /* ignore */ }
}

onMounted(async () => { await load(); window.addEventListener('resize', onResize); });
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose(); chart = null; });
function onResize() { chart?.resize(); }
watch(metric, async () => { await nextTick(); draw(); });
watch(isDark, async () => { await nextTick(); draw(); });
</script>

<template>
  <div class="mv">
    <header class="mvhead">
      <h3>{{ $t('master.title') }}</h3>
      <span class="mvhint">{{ $t('master.subtitle') }}</span>
      <button class="mvbtn" :disabled="loading" @click="load">{{ loading ? $t('master.loading') : $t('master.refresh') }}</button>
    </header>
    <div v-if="err" class="mverr">{{ err }}</div>
    <div v-if="!state.enabled" class="mverr">{{ $t('master.need_master') }}</div>

    <section class="cards">
      <div class="card">
        <div class="clabel">{{ $t('master.status') }}</div>
        <div class="cvalue" :class="{ ok: state.enabled }">{{ state.enabled ? $t('master.on') : $t('master.off') }}</div>
        <div class="chint">{{ state.address || '-' }}</div>
        <div v-if="state.enabled" class="chint">{{ state.forever ? $t('master.forever') : $t('master.enabled_until', { time: fmtTime(Number(state.expiresAt) || 0) }) }}</div>
        <div v-if="state.needRestart" class="mverr">{{ $t('master.need_restart') }}</div>
      </div>
      <div class="card"><div class="clabel">{{ $t('master.total_users') }}</div><div class="cvalue">{{ users.length }}</div></div>
      <div class="card"><div class="clabel">{{ $t('master.sessions') }}</div><div class="cvalue">{{ stats.totals.sessions }}</div></div>
      <div class="card"><div class="clabel">{{ $t('master.messages') }}</div><div class="cvalue">{{ stats.totals.messages }}</div></div>
      <div class="card"><div class="clabel">{{ $t('master.chars') }}</div><div class="cvalue">{{ stats.totals.chars }}</div></div>
    </section>

    <section class="box">
      <h4>{{ $t('remote.users_title') }}</h4>
      <div class="hint">{{ $t('remote.users_hint') }}</div>
      <div v-if="!users.length" class="hint">{{ $t('master.users_empty') }}</div>
      <div v-for="u in users" :key="u.id" class="userrow">
        <span class="uname">{{ u.username }}</span>
        <span class="ustat" :class="{ off: !u.enabled }">{{ u.enabled ? $t('remote.user_enabled') : $t('remote.user_disabled') }}</span>
        <input class="utoken" :value="u.token" readonly @focus="($event.target as HTMLInputElement).select()" />
        <button class="mvbtn small" @click="copy(u.token)">{{ $t('remote.copy') }}</button>
        <button class="mvbtn small" @click="toggleUser(u)">{{ u.enabled ? $t('remote.user_disable') : $t('remote.user_enable') }}</button>
        <button class="mvbtn small danger" @click="delUser(u)">×</button>
      </div>
      <div class="addrow">
        <input v-model="newUserName" :placeholder="$t('remote.username')" @keyup.enter="addUser" />
        <input v-model="newUserToken" :placeholder="$t('remote.token_optional')" @keyup.enter="addUser" />
        <button class="mvbtn" @click="addUser">{{ $t('remote.add_user') }}</button>
      </div>
      <div v-if="userMsg" class="hint">{{ userMsg }}</div>
    </section>

    <section class="box">
      <h4>{{ $t('master.daily_title') }}</h4>
      <div class="hint">{{ $t('master.daily_hint') }}</div>
      <div class="metric">
        <button class="mvbtn small" :class="{ on: metric === 'messages' }" @click="metric = 'messages'">{{ $t('master.metric_messages') }}</button>
        <button class="mvbtn small" :class="{ on: metric === 'chars' }" @click="metric = 'chars'">{{ $t('master.metric_chars') }}</button>
      </div>
      <div ref="chartEl" class="chart" />
    </section>

    <section class="box">
      <h4>{{ $t('master.monthly_title') }}</h4>
      <div class="hint">{{ $t('master.monthly_hint') }}</div>
      <div v-if="!monthList.length" class="hint">{{ $t('master.no_months') }}</div>
      <div v-else class="scroll">
        <table class="tbl">
          <thead><tr><th>{{ $t('master.col_user') }}</th><th v-for="m in monthList" :key="m">{{ m }}</th></tr></thead>
          <tbody>
            <tr v-for="u in monthlyUsers" :key="u.userId">
              <td>{{ nameOf(u.userId, u.userName) }}</td>
              <td v-for="m in monthList" :key="m" class="cell">
                <template v-if="monthCell(u.userId, m)">
                  <b>{{ monthCell(u.userId, m)!.messages }}</b>
                  <span class="sub">{{ monthCell(u.userId, m)!.chars }} {{ $t('master.chars') }}</span>
                </template>
                <span v-else class="sub">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="box">
      <h4>{{ $t('master.sessions_title') }}</h4>
      <div v-if="!stats.sessions.length" class="hint">{{ $t('master.no_sessions') }}</div>
      <div v-else class="scroll">
        <table class="tbl">
          <thead><tr>
            <th>{{ $t('master.col_user') }}</th>
            <th>{{ $t('master.col_session') }}</th>
            <th>{{ $t('master.col_project') }}</th>
            <th>{{ $t('master.col_messages') }}</th>
            <th>{{ $t('master.col_chars') }}</th>
            <th>{{ $t('master.col_last') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="s in stats.sessions" :key="`${s.userId}|${s.sessionId}|${s.tabName}|${s.projectId}`">
              <td>{{ nameOf(s.userId, s.userName) }}</td>
              <td>{{ sessionLabel(s) }}</td>
              <td>{{ projectLabel(s.projectId) }}</td>
              <td>{{ s.messages }}</td>
              <td>{{ s.chars }}</td>
              <td>{{ fmtTime(s.lastTs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mv { display: flex; flex-direction: column; gap: 12px; height: 100%; overflow: auto; padding: 14px; box-sizing: border-box; }
.mvhead { display: flex; align-items: center; gap: 10px; }
.mvhead h3 { margin: 0; font-size: 16px; color: var(--tx1); }
.mvhint { color: var(--tx4); font-size: 12px; flex: 1; }
.mvbtn { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.mvbtn:hover { border-color: var(--ac2); color: var(--ac2); }
.mvbtn.small { padding: 3px 8px; font-size: 11px; }
.mvbtn.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.mvbtn.danger { color: var(--err); border-color: var(--err); }
.mverr { color: var(--err); font-size: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); display: flex; flex-direction: column; gap: 4px; }
.clabel { color: var(--tx4); font-size: 12px; }
.cvalue { color: var(--tx1); font-size: 20px; font-weight: 700; }
.cvalue.ok { color: var(--ac2); }
.chint { color: var(--tx4); font-size: 11px; word-break: break-all; }
.box { border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; background: var(--bg2); display: flex; flex-direction: column; gap: 6px; }
.box h4 { margin: 0; font-size: 13px; color: var(--tx1); }
.hint { color: var(--tx4); font-size: 12px; }
.userrow { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--bd2); }
.uname { min-width: 90px; color: var(--tx1); font-weight: 600; font-size: 12px; }
.ustat { font-size: 11px; color: var(--ac2); }
.ustat.off { color: var(--tx4); }
.utoken { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx3); border-radius: 4px; padding: 3px 6px; font-size: 11px; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.addrow { display: flex; gap: 6px; margin-top: 6px; }
.addrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; box-sizing: border-box; }
.metric { display: flex; gap: 6px; }
.chart { height: 240px; }
.scroll { max-height: 320px; overflow: auto; }
.tbl { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.tbl th, .tbl td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx2); }
.tbl th { position: sticky; top: 0; background: var(--bg4); color: var(--tx1); }
.cell .sub { display: block; color: var(--tx4); font-size: 10px; }
.sub { color: var(--tx4); }
</style>
