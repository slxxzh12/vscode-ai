import { ref } from 'vue';

// 自动检查升级（本机浏览器偏好）：必须先征得用户同意；关闭后不再联网检查最新版本。
const UPGRADE_AUTO_KEY = 'devflow-upgrade-auto';
const UPGRADE_ASKED_KEY = 'devflow-upgrade-asked';

function readItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

// 是否已就「自动检查升级」征求过用户意见。
// 旧版本已有的自动检查勾选视为已同意（或已拒绝），升级后不再重复弹窗。
export function loadUpgradeAsked(): boolean {
  const asked = readItem(UPGRADE_ASKED_KEY);
  if (asked !== null) return asked === '1';
  return readItem(UPGRADE_AUTO_KEY) !== null;
}

export const upgradeAsked = ref(loadUpgradeAsked());

export function loadAutoCheckUpgrade(): boolean {
  try { return localStorage.getItem(UPGRADE_AUTO_KEY) !== '0'; } catch { return true; }
}

export const autoCheckUpgrade = ref(loadAutoCheckUpgrade());

export function setAutoCheckUpgrade(v: boolean): boolean {
  autoCheckUpgrade.value = !!v;
  try { localStorage.setItem(UPGRADE_AUTO_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  return autoCheckUpgrade.value;
}

export function setUpgradeAsked(v = true): boolean {
  upgradeAsked.value = !!v;
  try { localStorage.setItem(UPGRADE_ASKED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  return upgradeAsked.value;
}
