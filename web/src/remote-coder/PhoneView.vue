<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useTerminal } from '../useTerminal';
import { useCenter } from '../useCenter';
import TerminalView from '../components/TerminalView.vue';
import JsoncPanel from './JsoncPanel.vue';
import { fetchScreenRev, requestShot, waitForNewScreen } from './useRemoteCoder';
import { t } from '../i18n';
import { elementLocale } from '../element-locale';
import { ElConfigProvider } from 'element-plus';

const terminal = useTerminal({});
const center = useCenter();
const showJsonc = ref(false);

const rev = ref('');
const pending = ref(false);
const status = ref('');
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string, autoClearMs = 4000) {
  status.value = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  if (autoClearMs > 0) statusTimer = setTimeout(() => { status.value = ''; statusTimer = null; }, autoClearMs);
}

function clockLabel(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function onShot() {
  if (pending.value) return;
  pending.value = true;
  const prev = rev.value;
  showStatus(t('remote.shot_pending'), 0);
  try {
    await requestShot();
    const next = await waitForNewScreen(prev);
    if (!next) { showStatus(t('remote.shot_timeout')); return; }
    rev.value = next.rev;
    showStatus(t('remote.shot_done', { time: clockLabel() }));
  } catch (e) {
    showStatus((e as Error).message || String(e));
  } finally {
    pending.value = false;
  }
}

onMounted(async () => {
  rev.value = await fetchScreenRev();
  terminal.connect();
});
onBeforeUnmount(() => {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  terminal.disconnect();
});
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
  <div class="phone">
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="jsonc" :title="$t('remote.jsonc_open')" @click="showJsonc = true">{}</button>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
    <div class="body">
      <TerminalView :terminal="terminal" :center="center" :project-id="null" :phone="true" />
    </div>
    <JsoncPanel v-if="showJsonc" @close="showJsonc = false" />
  </div>
  </ElConfigProvider>
</template>

<style scoped>
.phone { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.ph { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.ttl { font-weight: 700; color: var(--tx1); }
.shot { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
.jsonc { background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd2); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; font-family: monospace; }
.shot:disabled { opacity: .6; cursor: default; }
.st { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; min-height: 0; display: flex; }
.body :deep(.center-wrap) { flex: 1; min-width: 0; }
</style>
