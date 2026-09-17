<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchScreenRev, requestShot, screenUrl, sendRemoteMessage, waitForNewScreen } from './useRemoteCoder';
import { t } from '../i18n';

const rev = ref('');
const pending = ref(false);
const status = ref('');
const text = ref('');
const sending = ref(false);
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

async function onSend() {
  const body = text.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  try {
    await sendRemoteMessage(body);
    text.value = '';
    showStatus(t('remote.sent'));
  } catch (e) {
    showStatus(t('remote.send_failed', { msg: (e as Error).message || String(e) }));
  } finally {
    sending.value = false;
  }
}

onMounted(async () => { rev.value = await fetchScreenRev(); });
</script>

<template>
  <div class="phone">
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
    <div class="screen">
      <img v-if="rev" class="img" :src="screenUrl(rev)" alt="opencode" />
      <div v-else class="empty">{{ $t('remote.no_screen') }}</div>
    </div>
    <footer class="pf">
      <textarea
        v-model="text"
        class="inp"
        :placeholder="$t('remote.placeholder')"
        @keydown.enter.exact.prevent="onSend"
      />
      <button class="send" :disabled="sending || !text.trim()" @click="onSend">{{ $t('remote.send') }}</button>
    </footer>
  </div>
</template>

<style scoped>
.phone { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.ph { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.ttl { font-weight: 700; color: var(--tx1); }
.shot { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
.shot:disabled { opacity: .6; cursor: default; }
.st { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.screen { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto; background: var(--bg3); }
.img { max-width: 100%; max-height: 100%; object-fit: contain; }
.empty { color: var(--tx4); font-size: 13px; }
.pf { flex: none; display: flex; align-items: stretch; gap: 8px; padding: 8px 10px; background: var(--bg2); border-top: 1px solid var(--bd2); }
.inp { flex: 1; min-width: 0; min-height: 52px; background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 8px; padding: 8px 10px; font-size: 14px; line-height: 1.5; resize: none; outline: none; font-family: inherit; }
.inp:focus { border-color: var(--ac2); }
.send { background: var(--ac); color: var(--onac); border: none; border-radius: 8px; padding: 0 20px; cursor: pointer; font-size: 14px; font-weight: 700; flex: none; }
.send:disabled { opacity: .55; cursor: default; }
</style>
