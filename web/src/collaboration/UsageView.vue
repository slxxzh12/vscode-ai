<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { t } from '../i18n';
import { isOnline, sortPeers, usageCells } from './usagePeers';
import type { CollabUsage } from './types';

const props = defineProps<{ terminal: { on: (type: string, cb: (p: any) => void) => () => void } }>();
const peers = ref<Record<string, CollabUsage>>({});
const cfg = ref<{ masterUrl: string; token: string; days?: number }>({ masterUrl: '', token: '' });
const st = ref<{ lastAt: number; lastOk: boolean | null; lastError: string; nextAt: number }>({ lastAt: 0, lastOk: null, lastError: '', nextAt: 0 });
const link = ref('');
const msg = ref('');
const rows = computed(() => sortPeers(peers.value));
const fmtTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : t('usage.not_configured'));

async function loadPeers() {
  try { const r = await fetch('/api/usage/peers').then((x) => x.json()); peers.value = r.peers || {}; } catch { /* ignore */ }
}
async function loadReporter() {
  try {
    const r = await fetch('/api/usage/reporter').then((x) => x.json());
    cfg.value = r.config || cfg.value;
    st.value = r.status || st.value;
  } catch { /* ignore */ }
}
async function save() {
  msg.value = '';
  const res = await fetch('/api/usage/reporter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: link.value }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { msg.value = t(data.error === 'bad-link' ? 'usage.bad_link' : 'usage.reported_fail', { msg: data.error || res.status }); return; }
  cfg.value = data.config;
  st.value = data.status;
  msg.value = t('usage.saved');
}
async function reportNow() {
  msg.value = '';
  const r = await fetch('/api/usage/reporter/now', { method: 'POST' }).then((x) => x.json()).catch(() => null);
  if (!r) return;
  st.value = r.status;
  msg.value = r.status.lastOk ? t('usage.reported_ok', { time: fmtTime(r.status.lastAt) }) : t('usage.reported_fail', { msg: r.status.lastError });
}

let off: (() => void) | null = null;
onMounted(() => {
  loadPeers(); loadReporter();
  off = props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, () => loadPeers());
});
onBeforeUnmount(() => { if (off) off(); });
</script>

<template>
  <div class="uv">
    <div class="sec">
      <div class="stitle">{{ $t('usage.title') }}</div>
      <div v-if="!rows.length" class="hint">{{ $t('usage.empty') }}</div>
      <table v-else class="ptable">
        <thead>
          <tr>
            <th>{{ $t('usage.machine') }}</th>
            <th>{{ $t('usage.sessions') }}</th>
            <th>{{ $t('usage.days') }}</th>
            <th>{{ $t('usage.messages') }}</th>
            <th>{{ $t('usage.input') }}</th>
            <th>{{ $t('usage.output') }}</th>
            <th>{{ $t('usage.cost') }}</th>
            <th>{{ $t('usage.last_report') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in rows" :key="p.machineId">
            <td class="who">
              <span class="dot" :class="{ on: isOnline(p.receivedAt) }" />
              {{ (p.employeeId || p.username || p.machineId) }}<span class="host">@{{ p.host }}:{{ p.port }}</span>
            </td>
            <td v-for="(c, i) in usageCells(p)" :key="i">{{ c }}</td>
            <td>{{ fmtTime(p.receivedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sec">
      <div class="stitle">{{ $t('usage.report_to_master') }}</div>
      <div class="row">
        <input v-model="link" :placeholder="$t('usage.link_placeholder')" @keyup.enter="save" />
        <button class="ghost" @click="save">{{ $t('usage.save') }}</button>
        <button class="ghost" @click="reportNow">{{ $t('usage.report_now') }}</button>
      </div>
      <div class="hint" v-if="cfg.masterUrl">{{ cfg.masterUrl }}</div>
      <div class="hint" v-if="st.lastOk !== null">{{ st.lastOk ? $t('usage.reported_ok', { time: fmtTime(st.lastAt) }) : $t('usage.reported_fail', { msg: st.lastError }) }}</div>
      <div class="hint" v-if="st.nextAt">{{ $t('usage.next_at', { time: fmtTime(st.nextAt) }) }}</div>
      <div class="err" v-if="msg">{{ msg }}</div>
    </div>
  </div>
</template>

<style scoped>
.uv { padding: 14px; overflow: auto; }
.sec { margin-bottom: 22px; }
.stitle { font-weight: 700; color: var(--ac3); margin-bottom: 8px; }
.hint { color: var(--tx6); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.ptable { border-collapse: collapse; font-size: 12px; width: 100%; }
.ptable th, .ptable td { border: 1px solid var(--bd); padding: 4px 8px; text-align: right; }
.ptable th:first-child, .ptable td:first-child { text-align: left; }
.who { display: flex; align-items: center; gap: 6px; }
.host { color: var(--tx6); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); flex: none; }
.dot.on { background: #4caf50; }
.row { display: flex; gap: 8px; }
.row input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 10px; cursor: pointer; }
</style>
