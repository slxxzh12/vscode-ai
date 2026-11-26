<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';

interface RunFile { path: string; size: number }

const props = withDefaults(defineProps<{ runId: string; apiRoot?: string; showBack?: boolean }>(), {
  apiRoot: '/__api',
  showBack: true,
});
const apiBase = `${props.apiRoot}/runs/${encodeURIComponent(props.runId)}`;
const siteBase = props.apiRoot.replace(/\/__api$/, '');

const tab = ref<'term' | 'out'>('term');
const log = ref('');
const status = ref('running');
const plugin = ref('');
const files = ref<RunFile[]>([]);
const input = ref('');
const sending = ref(false);
const termEl = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let filesLoaded = false;

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
function clean(text: string): string {
  return String(text || '').replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const running = computed(() => status.value === 'running');
const statusLabel = computed(() => {
  if (status.value === 'running') return t('ai_site.run.status.running');
  if (status.value === 'success') return t('ai_site.run.status.success');
  if (status.value === 'timeout') return t('ai_site.run.status.timeout');
  return t('ai_site.run.status.error');
});
const tagType = computed(() => (status.value === 'running' ? 'warning' : status.value === 'success' ? 'success' : 'danger'));
const statusClass = computed(() => (status.value === 'running' ? 'running' : status.value === 'success' ? 'success' : 'error'));
const outputLabel = computed(() => t('ai_site.run.tab.outputs') + (files.value.length ? ` (${files.value.length})` : ''));

function fmtSize(n: number): string {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
function fileUrl(f: RunFile, download = false): string {
  return `${props.apiRoot}/runs/${encodeURIComponent(props.runId)}/file?path=${encodeURIComponent(f.path)}${download ? '&download=1' : ''}`;
}
function openFile(f: RunFile) { window.open(fileUrl(f), '_blank', 'noopener'); }
function downloadFile(f: RunFile) { window.open(fileUrl(f, true), '_blank', 'noopener'); }
function downloadZip() { window.open(`${props.apiRoot}/runs/${encodeURIComponent(props.runId)}/zip`, '_blank', 'noopener'); }

async function loadFiles() {
  if (filesLoaded) return;
  filesLoaded = true;
  try {
    const r = await fetch(`${apiBase}/files`);
    const j = await r.json();
    files.value = Array.isArray(j.items) ? j.items : [];
  } catch { /* ignore */ }
}

async function tick() {
  try {
    const r = await fetch(apiBase);
    if (r.ok) {
      const m = await r.json();
      log.value = clean(m.log || '');
      status.value = m.status || 'error';
      if (m.plugin) plugin.value = m.plugin;
      if (m.status !== 'running') {
        await loadFiles();
        if (timer) { clearInterval(timer); timer = null; }
      }
    }
  } catch { /* ignore */ }
}

async function send() {
  const text = input.value.trim();
  if (!text || !running.value) return;
  sending.value = true;
  try {
    const r = await fetch(`${apiBase}/input`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${text}\n` }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `HTTP ${r.status}`);
    }
    input.value = '';
  } catch (e) {
    ElMessage.error(String((e as Error)?.message || e));
  } finally {
    sending.value = false;
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

watch(log, async () => {
  await nextTick();
  const el = termEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});

onMounted(() => {
  if (props.showBack) document.title = `${t('ai_site.run.title')} · ${props.runId}`;
  void tick();
  timer = setInterval(() => { void tick(); }, 700);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="run">
    <header class="top">
      <span class="dot" :class="statusClass" />
      <b class="title">{{ plugin || t('ai_site.run.title') }}</b>
      <el-tag size="small" :type="tagType" effect="plain">{{ statusLabel }}</el-tag>
      <span class="spacer" />
      <a v-if="props.showBack" class="back" :href="siteBase ? siteBase + '/' : '/'">{{ t('ai_site.title') }}</a>
    </header>

    <main class="run-main">
      <el-tabs v-model="tab" class="run-tabs">
        <el-tab-pane :label="t('ai_site.run.tab.terminal')" name="term">
          <div class="termwrap">
            <pre ref="termEl" class="term">{{ log }}</pre>
            <div class="composer">
              <el-input
                v-model="input"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 4 }"
                :placeholder="running ? t('ai_site.run.input_ph') : t('ai_site.run.finished')"
                :disabled="!running"
                @keydown="onKey"
              />
              <el-button type="primary" :loading="sending" :disabled="!running || !input.trim()" @click="send">
                {{ t('ai_site.run.send') }}
              </el-button>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="outputLabel" name="out">
          <div class="outwrap">
            <div class="outbar">
              <el-button size="small" type="primary" plain @click="downloadZip">{{ t('ai_site.result.zip') }}</el-button>
            </div>
            <el-table :data="files" size="small" :empty-text="running ? t('ai_site.run.wait_outputs') : t('ai_site.result.empty')">
              <el-table-column prop="path" :label="t('ai_site.result.file')" min-width="240" show-overflow-tooltip />
              <el-table-column :label="t('ai_site.result.size')" width="100" align="right">
                <template #default="{ row }">{{ fmtSize(row.size) }}</template>
              </el-table-column>
              <el-table-column :label="t('ai_site.result.actions')" width="170">
                <template #default="{ row }">
                  <el-button size="small" text type="primary" @click="openFile(row)">{{ t('static_site.open') }}</el-button>
                  <el-button size="small" text @click="downloadFile(row)">{{ t('ai_site.result.download') }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </main>
  </div>
</template>

<style scoped>
.run { height: 100%; display: flex; flex-direction: column; background: var(--bg3, #eef1f5); color: var(--tx1, #26303c); font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
.top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--bd, #ccd4de); background: var(--bg1, #dfe5ec); flex: none; }
.title { font-size: 15px; }
.spacer { flex: 1; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; flex: none; }
.dot.running { background: #eab308; animation: pulse 1s ease-in-out infinite; }
.dot.success { background: #22c55e; }
.dot.error { background: #ef4444; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.back { color: var(--ac2, #2563eb); text-decoration: none; font-size: 13px; }
.back:hover { text-decoration: underline; }
.run-main { flex: 1; min-height: 0; padding: 10px 14px 12px; display: flex; flex-direction: column; }
.run-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.run-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.run-tabs :deep(.el-tab-pane) { height: 100%; }
.termwrap { height: 100%; display: flex; flex-direction: column; gap: 8px; }
.term { flex: 1; min-height: 0; margin: 0; padding: 14px 16px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #1b2430; color: #cfd9e6; border: 1px solid #2b3644; border-radius: 10px; font: 12.5px/1.55 ui-monospace, Consolas, "Cascadia Mono", "Courier New", monospace; }
.composer { display: flex; gap: 8px; align-items: flex-end; flex: none; }
.composer :deep(.el-textarea) { flex: 1; }
.outwrap { height: 100%; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.outbar { display: flex; justify-content: flex-end; }
</style>
