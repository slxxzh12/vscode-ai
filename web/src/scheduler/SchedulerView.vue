<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useScheduler, type TaskView } from './useScheduler';
import { scheduleSummary, formatTime, runStatusLabel } from './format';
import type { SchedulerRun } from '@devflow/shared/scheduler';

const props = defineProps<{ terminal: any }>();
const sched = useScheduler(props.terminal);
const { state } = sched;

const projects = ref<{ id: string; name: string; root: string }[]>([]);
const showEditor = ref(false);
const editingId = ref<string | null>(null);
const form = ref<any>(emptyForm());
const runs = ref<SchedulerRun[]>([]);
const runsTaskId = ref<string | null>(null);
const logText = ref('');
const logRunId = ref<string | null>(null);
let logTimer: ReturnType<typeof setInterval> | null = null;

function emptyForm() {
  return {
    name: '', enabled: true, projectId: '', cwd: '', type: 'shell', command: '',
    ai: { source: 'command', commandName: '', prompt: '' }, script: { path: '' },
    schedule: { mode: 'interval', interval: { every: 30, unit: 'minute' }, daily: { at: '09:30', weekdays: [] } },
  };
}
async function loadProjects() {
  try { const d = await fetch('/api/projects').then((r) => r.json()); projects.value = d.projects || []; }
  catch { projects.value = []; }
}
function openCreate() { editingId.value = null; form.value = emptyForm(); showEditor.value = true; }
function openEdit(t: TaskView) {
  editingId.value = t.id;
  form.value = JSON.parse(JSON.stringify({
    name: t.name, enabled: t.enabled, projectId: t.projectId || '', cwd: t.cwd || '', type: t.type,
    command: t.command || '', ai: t.ai || { source: 'command', commandName: '', prompt: '' },
    script: t.script || { path: '' }, schedule: t.schedule,
  }));
  showEditor.value = true;
}
async function save() {
  const body = JSON.parse(JSON.stringify(form.value));
  if (!body.projectId) body.projectId = null;
  if (!body.cwd) body.cwd = null;
  if (body.type !== 'shell') delete body.command;
  if (body.type !== 'ai') delete body.ai;
  if (body.type !== 'script') delete body.script;
  try {
    if (editingId.value) await sched.updateTask(editingId.value, body);
    else await sched.createTask(body);
    showEditor.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function remove(t: TaskView) {
  if (!confirm(`删除任务「${t.name}」？`)) return;
  await sched.removeTask(t.id);
}
async function runNow(t: TaskView) {
  try { await sched.runNow(t.id); await sched.refresh(); }
  catch (e: any) { state.error = String(e?.message || e); }
}
async function stop(t: TaskView) { await sched.stopTask(t.id); await sched.refresh(); }
async function toggle(t: TaskView) { await sched.updateTask(t.id, { enabled: !t.enabled }); }
async function openRuns(t: TaskView) {
  runsTaskId.value = t.id;
  runs.value = await sched.loadRuns(t.id);
  logText.value = '';
  logRunId.value = null;
  startLogTimer();
}
async function openLog(r: SchedulerRun) { logRunId.value = r.id; logText.value = await sched.loadLog(r.id); }
function startLogTimer() {
  stopLogTimer();
  logTimer = setInterval(async () => {
    if (!runsTaskId.value) return;
    runs.value = await sched.loadRuns(runsTaskId.value);
    if (logRunId.value) logText.value = await sched.loadLog(logRunId.value);
  }, 2000);
}
function stopLogTimer() { if (logTimer) { clearInterval(logTimer); logTimer = null; } }
function closeRuns() { runsTaskId.value = null; logRunId.value = null; logText.value = ''; stopLogTimer(); }
const WEEKDAYS = [{ v: 1, t: '一' }, { v: 2, t: '二' }, { v: 3, t: '三' }, { v: 4, t: '四' }, { v: 5, t: '五' }, { v: 6, t: '六' }, { v: 7, t: '日' }];
function toggleWeekday(v: number) {
  const arr: number[] = form.value.schedule.daily.weekdays;
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}

onMounted(async () => { await loadProjects(); await sched.refresh(); sched.loadAiCommands(); });
onBeforeUnmount(() => { stopLogTimer(); sched.dispose(); });
</script>

<template>
  <div class="sched">
    <header class="bar">
      <span class="title">定时任务</span>
      <span v-if="state.error" class="err">{{ state.error }}</span>
      <div class="spacer" />
      <button @click="sched.refresh()">刷新</button>
      <button class="primary" @click="openCreate">新建任务</button>
    </header>

    <div class="body">
      <div class="list">
        <div v-if="!state.tasks.length" class="empty">暂无定时任务，点右上角新建</div>
        <div v-for="t in state.tasks" :key="t.id" class="row">
          <div class="rowmain">
            <div class="name">
              <span class="badge" :class="t.type">{{ t.type === 'shell' ? '命令' : t.type === 'ai' ? 'AI' : '脚本' }}</span>
              {{ t.name }}
              <span class="dim">{{ scheduleSummary(t.schedule) }}</span>
            </div>
            <div class="meta">
              <span v-if="t.runningRunId" class="dot running" />{{ t.runningRunId ? '运行中' : '' }}
              <span class="dim">下次 {{ formatTime(t.nextRunAt) }}</span>
            </div>
          </div>
          <div class="acts">
            <label class="sw"><input type="checkbox" :checked="t.enabled" @change="toggle(t)" /> 启用</label>
            <button v-if="!t.runningRunId" @click="runNow(t)">运行</button>
            <button v-else @click="stop(t)">停止</button>
            <button @click="openRuns(t)">历史</button>
            <button @click="openEdit(t)">编辑</button>
            <button @click="remove(t)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showEditor" class="overlay" @click.self="showEditor = false">
      <div class="modal">
        <h3>{{ editingId ? '编辑任务' : '新建任务' }}</h3>
        <label>名称 <input v-model="form.name" /></label>
        <label>项目
          <select v-model="form.projectId">
            <option value="">（不绑定）</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label>目录覆盖（可选） <input v-model="form.cwd" placeholder="留空则用项目根" /></label>
        <label>类型
          <select v-model="form.type">
            <option value="shell">命令</option>
            <option value="ai">AI 命令</option>
            <option value="script">脚本</option>
          </select>
        </label>
        <template v-if="form.type === 'shell'">
          <label>命令内容 <textarea v-model="form.command" rows="3" /></label>
        </template>
        <template v-else-if="form.type === 'ai'">
          <label>来源
            <select v-model="form.ai.source">
              <option value="command">从 command 列表选</option>
              <option value="prompt">手写 prompt</option>
            </select>
          </label>
          <label v-if="form.ai.source === 'command'">Command
            <select v-model="form.ai.commandName">
              <option value="">请选择</option>
              <option v-for="c in state.aiCommands" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
          </label>
          <label v-else>Prompt <textarea v-model="form.ai.prompt" rows="4" /></label>
        </template>
        <template v-else>
          <label>脚本路径（相对项目根或绝对） <input v-model="form.script.path" /></label>
        </template>

        <label>调度方式
          <select v-model="form.schedule.mode">
            <option value="interval">按周期</option>
            <option value="daily">每日时刻</option>
          </select>
        </label>
        <template v-if="form.schedule.mode === 'interval'">
          <label>每 <input type="number" min="1" v-model.number="form.schedule.interval.every" style="width:80px" />
            <select v-model="form.schedule.interval.unit">
              <option value="second">秒</option>
              <option value="minute">分钟</option>
              <option value="hour">小时</option>
              <option value="day">天</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label>时刻 <input type="time" v-model="form.schedule.daily.at" /></label>
          <div class="wd">
            星期（不选=每天）：
            <label v-for="w in WEEKDAYS" :key="w.v" class="wditem">
              <input type="checkbox" :checked="form.schedule.daily.weekdays.includes(w.v)" @change="toggleWeekday(w.v)" />{{ w.t }}
            </label>
          </div>
        </template>

        <div class="modalacts">
          <button @click="showEditor = false">取消</button>
          <button class="primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <div v-if="runsTaskId" class="overlay" @click.self="closeRuns">
      <div class="modal wide">
        <h3>运行历史</h3>
        <div class="histwrap">
          <div class="histlist">
            <div v-for="r in runs" :key="r.id" class="histitem" :class="{ on: r.id === logRunId }" @click="openLog(r)">
              <span class="dot" :class="r.status" />{{ formatTime(r.startedAt) }}
              <span class="dim">{{ runStatusLabel(r.status) }} · {{ r.durationMs ?? '—' }}ms</span>
            </div>
            <div v-if="!runs.length" class="empty">暂无运行记录</div>
          </div>
          <pre class="logview">{{ logText || '（选择一次运行查看输出）' }}</pre>
        </div>
        <div class="modalacts"><button @click="closeRuns">关闭</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sched { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.bar .title { font-weight: 700; color: var(--tx1); }
.bar .spacer { flex: 1; }
.bar .err { color: var(--warn, #e5534b); font-size: 12px; }
.bar button, .modalacts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.bar button.primary, .modalacts button.primary { background: var(--ac3, var(--ac2)); border-color: var(--ac3, var(--ac2)); color: #fff; }
.body { flex: 1; overflow: auto; padding: 8px 12px; }
.empty { color: var(--tx5); padding: 24px; text-align: center; }
.row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--bd); border-radius: 6px; margin-bottom: 6px; background: var(--bg1); }
.rowmain { flex: 1; min-width: 0; }
.name { color: var(--tx1); display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--bg5, var(--bg4)); color: var(--tx2); }
.badge.ai { background: var(--ac2); color: #fff; }
.badge.script { background: var(--warn, #b58900); color: #000; }
.meta { color: var(--tx4); font-size: 12px; margin-top: 2px; display: flex; gap: 12px; align-items: center; }
.dim { color: var(--tx5); font-size: 12px; }
.acts { display: flex; gap: 4px; align-items: center; flex: none; }
.acts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.sw { color: var(--tx4); font-size: 12px; display: flex; align-items: center; gap: 3px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx5); margin-right: 4px; }
.dot.running { background: var(--ac2); }
.dot.success { background: #3fb950; }
.dot.failed, .dot.timeout { background: #e5534b; }
.dot.killed { background: var(--tx5); }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; width: 460px; max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.modal.wide { width: 720px; }
.modal h3 { margin: 0 0 6px; color: var(--tx1); }
.modal label { display: flex; flex-direction: column; gap: 3px; color: var(--tx3); font-size: 12px; }
.modal input, .modal select, .modal textarea { background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-family: inherit; }
.wd { color: var(--tx3); font-size: 12px; }
.wditem { display: inline-flex; flex-direction: row; align-items: center; gap: 2px; margin-right: 6px; }
.modalacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.histwrap { display: flex; gap: 8px; min-height: 260px; }
.histlist { width: 220px; overflow: auto; border-right: 1px solid var(--bd); }
.histitem { padding: 5px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--tx2); }
.histitem.on { background: var(--bg5, var(--bg4)); }
.logview { flex: 1; margin: 0; overflow: auto; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; padding: 8px; white-space: pre-wrap; }
</style>
