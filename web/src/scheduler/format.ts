import type { Schedule } from '@devflow/shared/scheduler';

const UNIT_LABEL: Record<string, string> = { second: '秒', minute: '分钟', hour: '小时', day: '天' };
const WD = ['', '一', '二', '三', '四', '五', '六', '日'];

export function scheduleSummary(s: Schedule): string {
  if (s.mode === 'interval') return `每 ${s.interval.every} ${UNIT_LABEL[s.interval.unit] || s.interval.unit}`;
  const days = (s.daily.weekdays || []).slice().sort((a, b) => a - b);
  let dayText: string;
  if (days.length === 0) dayText = '每天';
  else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) dayText = '工作日';
  else dayText = days.map((d) => '周' + WD[d]).join('、');
  return `${dayText} ${s.daily.at}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const STATUS_LABEL: Record<string, string> = { running: '运行中', success: '成功', failed: '失败', timeout: '超时', killed: '已停止' };
export function runStatusLabel(s: string): string {
  return STATUS_LABEL[s] || s;
}
