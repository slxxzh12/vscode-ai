import { reactive } from 'vue';
import { SchedulerS2C } from '@devflow/shared/scheduler';
import type { SchedulerTask, SchedulerJob, SchedulerSummary } from '@devflow/shared/scheduler';

export interface TaskView extends SchedulerTask {
  nextRunAt: number | null;
  recentJobs?: SchedulerJob[];
}
export interface AiCommandInfo { name: string; preview: string; }

async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

type TerminalLike = { on: (type: string, handler: (msg: any) => void) => () => void };

export function useScheduler(terminal?: TerminalLike) {
  const state = reactive({
    tasks: [] as TaskView[],
    summary: { total: 0, success: 0, failed: 0, running: 0, queued: 0, pending: 0 } as SchedulerSummary,
    aiCommands: [] as AiCommandInfo[],
    loading: false,
    error: '',
  });

  async function refresh() {
    state.loading = true;
    try {
      const d = await api('GET', '/api/scheduler/tasks');
      state.tasks = d.tasks || [];
      void loadSummary();
      state.error = '';
    } catch (e: any) {
      state.error = String(e?.message || e);
    } finally {
      state.loading = false;
    }
  }
  async function createTask(input: unknown) {
    const d = await api('POST', '/api/scheduler/tasks', input);
    await refresh();
    return d.task;
  }
  async function updateTask(id: string, patch: unknown) {
    const d = await api('PUT', `/api/scheduler/tasks/${encodeURIComponent(id)}`, patch);
    await refresh();
    return d.task;
  }
  async function removeTask(id: string) {
    await api('DELETE', `/api/scheduler/tasks/${encodeURIComponent(id)}`);
    await refresh();
  }
  function runNow(id: string) { return api('POST', `/api/scheduler/tasks/${encodeURIComponent(id)}/run`); }
  function stopTask(id: string) { return api('POST', `/api/scheduler/tasks/${encodeURIComponent(id)}/stop`); }
  async function loadJobs(taskId: string, limit = 50): Promise<SchedulerJob[]> {
    const d = await api('GET', `/api/scheduler/jobs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`);
    return d.jobs || [];
  }
  async function loadSummary() {
    try {
      const d = await api('GET', '/api/scheduler/summary');
      state.summary = {
        total: d.total || 0, success: d.success || 0, failed: d.failed || 0, running: d.running || 0,
        queued: d.queued || 0, pending: d.pending || 0,
      };
    } catch { /* 汇总失败不影响任务列表 */ }
  }
  async function loadAiCommands() {
    try {
      const d = await api('GET', '/api/scheduler/ai-commands');
      state.aiCommands = d.commands || [];
    } catch { state.aiCommands = []; }
  }
  function pickFile(): Promise<{ path?: string; content?: string | null; cancelled?: boolean; error?: string; message?: string }> {
    return api('POST', '/api/scheduler/pick-file');
  }
  function pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return api('POST', '/api/scheduler/pick-folder');
  }
  async function importManifests(dir: string): Promise<{ imported: number; overwritten: number; failed: { path: string; error: string }[] }> {
    const d = await api('POST', '/api/scheduler/import', { dir });
    await refresh();
    return d;
  }

  const unsubs: Array<() => void> = [];
  if (terminal) {
    const onAny = () => { refresh(); };
    unsubs.push(terminal.on(SchedulerS2C.SCHED_TASKS_CHANGED, onAny));
    unsubs.push(terminal.on(SchedulerS2C.SCHED_RUN_START, onAny));
    unsubs.push(terminal.on(SchedulerS2C.SCHED_RUN_END, onAny));
  }

  return { state, refresh, createTask, updateTask, removeTask, runNow, stopTask, loadJobs, loadSummary, loadAiCommands, pickFile, pickFolder, importManifests, dispose: () => unsubs.forEach((u) => u()) };
}
