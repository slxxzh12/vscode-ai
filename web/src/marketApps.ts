// 应用市场纯逻辑：客户端清单、下载文件分组/格式化（便于单测；组件只做渲染与交互）

export const DESKTOP_URL = 'https://gitee.com/slxxzh12/vscode-ai/releases';
export const MOBILE_URL = 'https://gitee.com/slxxzh12/vscode-ai-mobile/releases';
export const TUTORIAL_URL = 'https://space.bilibili.com/1933375113';
export const ISSUES_URL = 'https://gitee.com/slxxzh12/vscode-ai/issues';

export interface MarketClient {
  id: string;
  icon?: string;
  brand?: 'apple';
  labelKey: string;
  href: string;
  platform: 'desktop' | 'mobile';
  qr?: boolean;
  comingSoon?: boolean;
}

export const MARKET_CLIENTS: MarketClient[] = [
  { id: 'win', icon: '🪟', labelKey: 'market.client.win', href: DESKTOP_URL, platform: 'desktop' },
  { id: 'linux', icon: '🐧', labelKey: 'market.client.linux', href: DESKTOP_URL, platform: 'desktop', comingSoon: true },
  { id: 'mac_arm', brand: 'apple', labelKey: 'market.client.mac_arm', href: DESKTOP_URL, platform: 'desktop', comingSoon: true },
  { id: 'mac_x64', brand: 'apple', labelKey: 'market.client.mac_x64', href: DESKTOP_URL, platform: 'desktop', comingSoon: true },
  { id: 'android', icon: '🤖', labelKey: 'market.client.android', href: MOBILE_URL, platform: 'mobile', qr: true, comingSoon: true },
  { id: 'ios', icon: '📱', labelKey: 'market.client.ios', href: MOBILE_URL, platform: 'mobile', qr: true, comingSoon: true },
];

export interface ClientGroup { key: 'desktop' | 'mobile'; clients: MarketClient[] }

export function groupClients(clients: MarketClient[] | null | undefined): ClientGroup[] {
  const all = clients || [];
  return [
    { key: 'desktop', clients: all.filter((c) => c.platform === 'desktop') },
    { key: 'mobile', clients: all.filter((c) => c.platform === 'mobile') },
  ];
}

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

export function fmtTime(ms?: number | null): string {
  const n = Number(ms) || 0;
  if (!n) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface MarketGroups { skill: DownloadFile[]; other: DownloadFile[] }

// 这些类型不在应用市场「扩展」里展示：用量明细、群组分发包
const HIDDEN_KINDS = new Set(['usage', 'group']);

export function groupDownloadFiles(files: DownloadFile[] | null | undefined): MarketGroups {
  const skill: DownloadFile[] = [];
  const other: DownloadFile[] = [];
  for (const f of files || []) {
    if (!f || !f.name) continue;
    if (HIDDEN_KINDS.has(f.kind)) continue;
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
