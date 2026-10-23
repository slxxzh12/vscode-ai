import { reactive } from 'vue';

export interface Job {
  jobId: string; parentJobId?: string | null; topic?: string; groupName?: string | null;
  partitionId: number; status: number; weight?: number; runtime?: number | null;
  createIP?: string | null; workIP?: string | null; traceId?: string | null;
  createTime: number; lastUpdateTime: number; paramStr?: string; result?: string | null;
  maxRunMilliSecond?: number;
}
export interface PartitionStat { id: number; queued: number; running: number; pending: number; }
export interface JobSummary { queued: number; running: number; pending: number; success: number; failed: number; total: number; }

async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function useJobs() {
  const state = reactive({
    jobs: [] as Job[], summary: { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0 } as JobSummary,
    partitions: [] as PartitionStat[], partitionCount: 16, topic: 'scheduler.jobs',
    status: null as number | null, partition: null as number | null, taskId: '', loading: false, error: '',
  });
  async function refresh() {
    state.loading = true;
    try {
      const q = new URLSearchParams();
      if (state.status !== null) q.set('status', String(state.status));
      if (state.partition !== null) q.set('partition', String(state.partition));
      if (state.taskId.trim()) q.set('taskId', state.taskId.trim());
      const d = await api('GET', `/api/scheduler/jobs?${q}`);
      state.jobs = d.jobs || [];
      state.summary = { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0, ...(d.summary || {}) };
      state.partitions = d.partitions || [];
      state.partitionCount = d.partitionCount || 16;
      state.topic = d.topic || 'scheduler.jobs';
      state.error = '';
    } catch (e: any) { state.error = String(e?.message || e); }
    finally { state.loading = false; }
  }
  const action = (name: string) => (id: string) => api('POST', `/api/scheduler/jobs/${encodeURIComponent(id)}/${name}`);
  return {
    state, refresh,
    approve: action('approve'), reject: action('reject'), cancel: action('cancel'), retry: action('retry'),
    cleanup: (partitionId?: number) => api('POST', '/api/scheduler/jobs/cleanup', { partitionId }),
    loadWorkers: () => api('GET', '/api/scheduler/workers'),
    loadConfig: () => api('GET', '/api/scheduler/queue/config'),
    saveConfig: (body: unknown) => api('PUT', '/api/scheduler/queue/config', body),
    setPartitions: (count: number) => api('PUT', '/api/scheduler/queue/partitions', { count }),
  };
}
