import { computed, onBeforeUnmount, ref } from 'vue';
import { defaultSelection, missingRiskyConfirmations, selectionTotals } from './selection';
import type { DiskCleanResult, DiskScan, DiskSettings } from './types';

export type DiskPhase = 'idle' | 'scanning' | 'ready' | 'cleaning' | 'done' | 'error';

export function useDiskClean() {
  const phase = ref<DiskPhase>('idle');
  const error = ref('');
  const scan = ref<DiskScan | null>(null);
  const selected = ref<Set<string>>(new Set());
  const confirmed = ref<Set<string>>(new Set());
  const permanent = ref(false);
  const settings = ref<DiskSettings>({ exclusions: { dirs: [], patterns: [] }, customDirs: [] });
  const result = ref<DiskCleanResult | null>(null);
  const history = ref<any[]>([]);
  const busy = computed(() => phase.value === 'scanning' || phase.value === 'cleaning');
  const totals = computed(() => selectionTotals(scan.value?.categories || [], selected.value));
  const canClean = computed(() => phase.value === 'ready' && totals.value.count > 0);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function stopPolling() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }
  onBeforeUnmount(stopPolling);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function loadBasics() {
    const [overview, s, h] = await Promise.all([
      api<any>('/api/disk-clean/overview').catch(() => null),
      api<DiskSettings>('/api/disk-clean/settings').catch(() => settings.value),
      api<{ items: any[] }>('/api/disk-clean/history').catch(() => ({ items: [] })),
    ]);
    settings.value = s;
    history.value = h.items || [];
    return overview;
  }

  async function analyze() {
    if (busy.value) return;
    stopPolling();
    stopped = false;
    phase.value = 'scanning';
    error.value = '';
    result.value = null;
    try {
      const { scanId } = await api<{ scanId: string }>('/api/disk-clean/scan', { method: 'POST', body: '{}' });
      const poll = async () => {
        if (stopped) return;
        try {
          const task = await api<DiskScan>(`/api/disk-clean/scan/${scanId}`);
          const first = !scan.value || scan.value.id !== task.id;
          scan.value = task;
          if (first) {
            selected.value = defaultSelection(task.categories);
            confirmed.value = new Set();
          }
          const done = task.categories.filter((c) => c.status === 'done' || c.status === 'error');
          if (done.length === task.categories.length) { phase.value = 'ready'; return; }
        } catch (e: any) {
          if (String(e?.message || '') === 'scan_expired') { error.value = 'scan_expired'; phase.value = 'error'; return; }
          throw e;
        }
        timer = setTimeout(poll, 500);
      };
      await poll();
    } catch (e: any) {
      error.value = String(e?.message || e);
      phase.value = 'error';
    }
  }

  function toggle(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected.value = next;
  }

  function toggleConfirm(id: string) {
    const next = new Set(confirmed.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    confirmed.value = next;
  }

  function blockedRisky(): string[] {
    return missingRiskyConfirmations(scan.value?.categories || [], selected.value, confirmed.value);
  }

  async function clean() {
    if (!scan.value || !canClean.value) return;
    const missing = blockedRisky();
    if (missing.length) { error.value = 'need_confirm'; return; }
    phase.value = 'cleaning';
    error.value = '';
    try {
      const { jobId } = await api<{ jobId: string }>('/api/disk-clean/clean', {
        method: 'POST',
        body: JSON.stringify({
          scanId: scan.value.id,
          categoryIds: [...selected.value],
          permanent: permanent.value,
          confirmed: [...confirmed.value],
        }),
      });
      const poll = async () => {
        if (stopped) return;
        const st = await api<DiskCleanResult>(`/api/disk-clean/clean/${jobId}`);
        result.value = st;
        if (st.status === 'running') { timer = setTimeout(poll, 500); return; }
        phase.value = 'done';
      };
      await poll();
      history.value = (await api<{ items: any[] }>('/api/disk-clean/history').catch(() => ({ items: [] }))).items || [];
    } catch (e: any) {
      error.value = String(e?.message || e);
      phase.value = 'error';
    }
  }

  async function saveSettings(next: DiskSettings) {
    settings.value = await api<DiskSettings>('/api/disk-clean/settings', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    return settings.value;
  }

  return {
    phase, error, scan, selected, confirmed, permanent, settings, result, history,
    busy, totals, canClean, loadBasics, analyze, toggle, toggleConfirm, blockedRisky, clean, saveSettings,
  };
}
