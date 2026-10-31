import { ref } from 'vue';

export interface UpgradeInfo {
  ok: boolean; current: string; latest: string; hasUpdate: boolean;
  url: string; downloadUrl: string; checkedAt: number; stale?: boolean; error?: string;
}

const upgrade = ref<UpgradeInfo | null>(null);
const loading = ref(false);
let pending: Promise<void> | null = null;

function apply(d: UpgradeInfo | null) { if (d && typeof d === 'object') upgrade.value = d; }

export function loadUpgrade(): Promise<void> {
  if (pending) return pending;
  pending = fetch('/api/upgrade')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => apply(d as UpgradeInfo | null))
    .catch(() => { /* offline: keep */ })
    .finally(() => { pending = null; });
  return pending;
}

export async function checkNow(): Promise<void> {
  loading.value = true;
  try {
    const r = await fetch('/api/upgrade?refresh=1');
    apply(r.ok ? ((await r.json()) as UpgradeInfo) : null);
  } catch { /* ignore */ }
  finally { loading.value = false; }
}

// 是否自动弹窗：有新版、未被「不再提示」、且距上次弹窗满 10 天
export function shouldPopup(
  info: Pick<UpgradeInfo, 'hasUpdate' | 'latest'> | null,
  now: number,
  opts: { skip?: string; popupAt?: number; intervalMs?: number } = {},
): boolean {
  if (!info || !info.hasUpdate || !info.latest) return false;
  if (opts.skip && opts.skip === info.latest) return false;
  const interval = opts.intervalMs ?? 10 * 24 * 3600 * 1000;
  const last = Number(opts.popupAt || 0);
  return !last || now - last >= interval;
}

export function useUpgrade() { return { upgrade, loading, loadUpgrade, checkNow }; }
