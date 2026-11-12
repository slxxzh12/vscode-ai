import { ref } from 'vue';
import { autoCheckUpgrade, upgradeAsked } from './upgradePrefs';

export interface UpgradeInfo {
  ok: boolean; current: string; latest: string; hasUpdate: boolean;
  url: string; downloadUrl: string; checkedAt: number; stale?: boolean; error?: string;
}

const upgrade = ref<UpgradeInfo | null>(null);
const loading = ref(false);
let pending: Promise<void> | null = null;

function apply(d: UpgradeInfo | null) { if (d && typeof d === 'object') upgrade.value = d; }

// 自动检查必须同时满足：用户已明确同意 + 自动检查开关打开；未同意前一律不联网。
function autoEnabled(): boolean { return upgradeAsked.value && autoCheckUpgrade.value; }

export function loadUpgrade(): Promise<void> {
  if (!autoEnabled()) return Promise.resolve();
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
    await refreshUpgrade(true);
  }
  finally { loading.value = false; }
}

// 强制重新获取最新版本（不占用 checkNow 的 loading 状态，供升级入口打开时/定时刷新）
// force=true 用于用户手动「检查更新」；自动路径在未同意或关闭自动检查后直接跳过，不联网。
export async function refreshUpgrade(force = false): Promise<void> {
  if (!force && !autoEnabled()) return;
  try {
    const r = await fetch('/api/upgrade?refresh=1');
    apply(r.ok ? ((await r.json()) as UpgradeInfo) : null);
  } catch { /* ignore */ }
}

export function clearUpgrade(): void { upgrade.value = null; }

// 升级图标文字：带上最新版本号，避免只显示笼统的「新版本」
export function upgradeBadgeText(info: Pick<UpgradeInfo, 'latest'> | null | undefined, base: string): string {
  const v = String(info?.latest || '').trim();
  return v ? `${base} ${v}` : base;
}

// 打开升级入口时始终使用 releases 页面（永远是最新版本），不用某个固定版本的下载地址
export function upgradeOpenTarget(info: Pick<UpgradeInfo, 'url' | 'downloadUrl'> | null | undefined): string {
  return String(info?.url || '');
}

// 是否自动弹窗：有新版、未被「不再提示」、且距上次弹窗满 15 天
export function shouldPopup(
  info: Pick<UpgradeInfo, 'hasUpdate' | 'latest'> | null,
  now: number,
  opts: { skip?: string; popupAt?: number; intervalMs?: number } = {},
): boolean {
  if (!info || !info.hasUpdate || !info.latest) return false;
  if (opts.skip && opts.skip === info.latest) return false;
  const interval = opts.intervalMs ?? 15 * 24 * 3600 * 1000;
  const last = Number(opts.popupAt || 0);
  return !last || now - last >= interval;
}

export function useUpgrade() { return { upgrade, loading, loadUpgrade, refreshUpgrade, checkNow }; }
