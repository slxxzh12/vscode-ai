<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspace, type WorkspaceState } from '../useWorkspace';

const props = defineProps<{ state: WorkspaceState }>();
const ws = useWorkspace();
const busy = ref(false);
const name = ref('');
const err = ref('');

function fmt(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function pick(id: string) {
  busy.value = true; err.value = '';
  try { await ws.select(id); location.reload(); }
  catch (e: any) { err.value = String(e?.message || e); busy.value = false; }
}
async function createNew() {
  busy.value = true; err.value = '';
  try { await ws.create(name.value); location.reload(); }
  catch (e: any) { err.value = String(e?.message || e); busy.value = false; }
}
</script>

<template>
  <div class="wsoverlay">
    <div class="wsbox">
      <h3>{{ $t('ws.pick.title') }}</h3>
      <p class="wsdesc">{{ $t('ws.pick.desc') }}</p>
      <div class="wslist">
        <button v-for="p in props.state.profiles" :key="p.id" class="wsitem" :disabled="busy" @click="pick(p.id)">
          <span class="wsname">{{ p.name }}</span>
          <span class="wsmeta">:{{ p.port }} · {{ $t('ws.pick.projects', { count: p.projectCount ?? 0 }) }} · {{ $t('ws.pick.last_used') }} {{ fmt(p.lastUsedAt) }}</span>
          <span class="wsgo">{{ $t('ws.pick.use') }}</span>
        </button>
      </div>
      <div class="wsnew">
        <input v-model="name" :placeholder="$t('ws.pick.new_name')" :disabled="busy" />
        <button :disabled="busy" @click="createNew">{{ $t('ws.pick.create') }}</button>
      </div>
      <div v-if="err" class="wserr">{{ $t('ws.pick.failed', { msg: err }) }}</div>
    </div>
  </div>
</template>

<style scoped>
.wsoverlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.wsbox { width: 520px; max-width: 92vw; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 10px; padding: 18px 20px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.wsbox h3 { margin: 0 0 8px; font-size: 16px; }
.wsdesc { color: var(--tx3); font-size: 12px; margin: 0 0 12px; line-height: 1.6; }
.wslist { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow: auto; }
.wsitem { display: flex; align-items: center; gap: 10px; text-align: left; background: var(--bg3); border: 1px solid var(--bd); color: var(--tx1); border-radius: 8px; padding: 10px 12px; cursor: pointer; }
.wsitem:hover:not(:disabled) { border-color: var(--ac2); }
.wsname { font-weight: 700; }
.wsmeta { color: var(--tx3); font-size: 11px; flex: 1; }
.wsgo { color: var(--ac2); font-size: 12px; }
.wsnew { display: flex; gap: 8px; margin-top: 12px; }
.wsnew input { flex: 1; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 12px; }
.wsnew button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; }
.wserr { color: var(--errtx); font-size: 12px; margin-top: 10px; }
</style>
