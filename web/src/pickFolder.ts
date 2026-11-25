import { t } from './i18n';

// 所有「选择文件夹」入口统一走这里：后端弹系统选择框，前端共用请求与错误文案。
export interface PickResult {
  path?: string;
  cancelled?: boolean;
  error?: string;
  message?: string;
}

export async function requestPickFolder(url = '/api/projects/pick'): Promise<PickResult> {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json();
}

// 把选择结果映射为统一的本地化错误文案；无错误返回空串。
export function pickErrorText(r: PickResult | null | undefined): string {
  if (!r || !r.error) return '';
  return r.error === 'unsupported'
    ? t('pick.unsupported')
    : t('pick.failed', { msg: r.message || r.error });
}

// 高层封装：返回所选目录；取消返回 null；出错抛出已本地化的 Error。
export async function pickFolderPath(url = '/api/projects/pick'): Promise<string | null> {
  const r = await requestPickFolder(url);
  if (r?.error) throw new Error(pickErrorText(r));
  return r?.path || null;
}
