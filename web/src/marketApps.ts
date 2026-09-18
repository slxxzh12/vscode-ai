// 应用市场纯逻辑：客户端清单、下载文件分组/格式化（便于单测；组件只做渲染与交互）

export const DESKTOP_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
export const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
export const TUTORIAL_URL = 'https://space.bilibili.com/1933375113';
export const ISSUES_URL = 'https://gitee.com/slxxzh12/vscode-ai/issues';

export interface MarketClient {
  id: string;
  icon: string;
  labelKey: string;
  href: string;
  qr?: boolean;
}

export const MARKET_CLIENTS: MarketClient[] = [
  { id: 'win', icon: '🪟', labelKey: 'market.client.win', href: DESKTOP_URL },
  { id: 'mac_arm', icon: '🍎', labelKey: 'market.client.mac_arm', href: DESKTOP_URL },
  { id: 'mac_x64', icon: '🍎', labelKey: 'market.client.mac_x64', href: DESKTOP_URL },
  { id: 'android', icon: '🤖', labelKey: 'market.client.android', href: MOBILE_URL, qr: true },
  { id: 'ios', icon: '📱', labelKey: 'market.client.ios', href: MOBILE_URL, qr: true },
];

export interface DownloadFile { name: string; kind: string; size: number; updatedAt: number }

export const INSTALLABLE_KIND = 'skill';

export function installableOf(file: { kind?: string } | null | undefined): boolean {
  return !!file && file.kind === INSTALLABLE_KIND;
}

export function fmtSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export interface MarketGroups { skill: DownloadFile[]; other: DownloadFile[] }

export function groupDownloadFiles(files: DownloadFile[] | null | undefined): MarketGroups {
  const skill: DownloadFile[] = [];
  const other: DownloadFile[] = [];
  for (const f of files || []) {
    if (!f || !f.name) continue;
    (installableOf(f) ? skill : other).push(f);
  }
  const byNewest = (a: DownloadFile, b: DownloadFile) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  skill.sort(byNewest);
  other.sort(byNewest);
  return { skill, other };
}

const KNOWN_KINDS = new Set(['skill', 'workflow', 'group', 'usage', 'file']);

export function marketKindKey(kind: string): string {
  return KNOWN_KINDS.has(kind) ? `market.kind.${kind}` : 'market.kind.file';
}
