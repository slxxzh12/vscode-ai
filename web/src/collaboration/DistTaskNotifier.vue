<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { useCollab, type CollabApi } from './useCollab';
import type { useTerminal } from '../useTerminal';
import { kindKeyOf, taskItemCount, type DistTask } from './distTasks';
import { t } from '../i18n';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; collab?: CollabApi }>();
const api = props.collab ?? useCollab();
const pending = ref<DistTask[]>([]);
const open = ref(false);
const busy = ref('');
const msg = ref('');
let unsubs: (() => void)[] = [];

async function loadPending() {
  try {
    const r = await api.listTasks('pending');
    pending.value = r.tasks || [];
    if (pending.value.length) open.value = true;
  } catch { /* 离线保持现状 */ }
}
async function accept(task: DistTask) {
  busy.value = task.id; msg.value = '';
  try {
    const r = await api.acceptTask(task.id);
    msg.value = r.code === 'ok' ? t('collab.dist.task_popup.accepted') : t('collab.task.accept_failed', { msg: r.code });
  } catch (e: any) { msg.value = t('collab.task.accept_failed', { msg: String(e?.message || e) }); }
  finally { busy.value = ''; await loadPending(); if (!pending.value.length) open.value = false; }
}
async function reject(task: DistTask) {
  busy.value = task.id; msg.value = '';
  try { await api.ignoreTask(task.id); } finally { busy.value = ''; await loadPending(); if (!pending.value.length) open.value = false; }
}
onMounted(async () => {
  try { await api.refresh(); } catch { /* ignore */ }
  await loadPending();
  unsubs = [props.terminal.on(CollabS2C.COLLAB_TASKS, () => { loadPending(); })];
});
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
const total = computed(() => pending.value.reduce((n, x) => n + taskItemCount(x), 0));
const onlyUpload = computed(() => pending.value.length > 0 && pending.value.every((t) => t.kind === 'upload'));
const titleKey = computed(() => (onlyUpload.value ? 'collab.dist.task_popup.title_upload' : 'collab.dist.task_popup.title'));
const hintKey = computed(() => (onlyUpload.value ? 'collab.dist.task_popup.hint_upload' : 'collab.dist.task_popup.hint'));
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t(titleKey) }}</div>
        <div class="meta">{{ $t(hintKey) }}</div>
        <div class="list">
          <div v-for="task in pending" :key="task.id" class="row">
            <span class="ic">{{ task.kind === 'workflow' ? '🧩' : '🛠' }}</span>
            <div class="info">
              <span class="nm">{{ $t(kindKeyOf(task.kind)) }} · {{ task.name }}</span>
              <span class="sub">{{ $t('collab.task.items', { count: taskItemCount(task) }) }}</span>
            </div>
            <button class="btn" :disabled="busy === task.id" @click="reject(task)">{{ $t('collab.dist.task_popup.reject') }}</button>
            <button class="btn primary" :disabled="busy === task.id" @click="accept(task)">{{ task.kind === 'upload' ? $t('collab.dist.task_popup.accept_upload') : $t('collab.dist.task_popup.accept') }}</button>
          </div>
        </div>
        <div v-if="msg" class="ok">{{ msg }}</div>
        <div class="foot">
          <span class="cnt">{{ $t('collab.task.items', { count: total }) }}</span>
          <button class="btn" @click="open = false">{{ $t('collab.dist.task_popup.later') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 520px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.list { max-height: 260px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--bd2); }
.row:last-child { border-bottom: none; }
.ic { flex: none; font-size: 18px; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nm { color: var(--tx1); font-weight: 600; word-break: break-all; }
.sub { color: var(--tx6); font-size: 11px; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
.cnt { color: var(--tx6); font-size: 12px; }
.btn { padding: 5px 14px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.btn:disabled { opacity: .55; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
