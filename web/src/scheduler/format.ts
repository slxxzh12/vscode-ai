import type { Schedule } from '@devflow/shared/scheduler';
import { t } from '../i18n';

const UNIT_KEY: Record<string, string> = { second: 'sched.unit.second', minute: 'sched.unit.minute', hour: 'sched.unit.hour', day: 'sched.unit.day' };
const WD_KEY: Record<number, string> = { 1: 'sched.wd.1', 2: 'sched.wd.2', 3: 'sched.wd.3', 4: 'sched.wd.4', 5: 'sched.wd.5', 6: 'sched.wd.6', 7: 'sched.wd.7' };

export function scheduleSummary(s: Schedule): string {
  if (s.mode === 'interval') {
    const unit = UNIT_KEY[s.interval.unit] ? t(UNIT_KEY[s.interval.unit]) : s.interval.unit;
    return t('sched.every', { every: s.interval.every, unit });
  }
  const days = (s.daily.weekdays || []).slice().sort((a, b) => a - b);
  let dayText: string;
  if (days.length === 0) dayText = t('sched.every_day');
  else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) dayText = t('sched.workdays');
  else dayText = days.map((d) => (WD_KEY[d] ? t(WD_KEY[d]) : String(d))).join(t('sched.list_sep'));
  return `${dayText} ${s.daily.at}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const LEGACY_STATUS_KEY: Record<string, string> = { running: 'sched.status.running', success: 'sched.status.success', failed: 'sched.status.failed', timeout: 'sched.status.timeout', killed: 'sched.status.killed', paused: 'sched.status.paused' };
const JOB_STATUS_KEY: Record<number, string> = {
  0: 'jobs.status.queued', 1: 'jobs.status.success', 2: 'jobs.status.failed', 3: 'jobs.status.running', 4: 'jobs.status.pending',
};
export function runStatusLabel(s: number | string): string {
  if (typeof s === 'number') return t(JOB_STATUS_KEY[s] || 'jobs.status.failed');
  return LEGACY_STATUS_KEY[s] ? t(LEGACY_STATUS_KEY[s]) : s;
}

export function jobStatusClass(s: number): string {
  return s === 1 ? 'ok' : s === 2 ? 'bad' : s === 3 ? 'run' : s === 4 ? 'wait' : 'queue';
}

export function typeLabel(type: string): string {
  if (type === 'ai') return 'AI';
  if (type === 'workflow') return t('sched.type.workflow');
  return t(`sched.type.${type}`);
}

// jobs 为倒序（最新在前）；取最新 n 条并按时间递增返回，便于左→右展示
export function recentJobsOf<T extends { createTime: number }>(jobs: T[] | null | undefined, n = 5): T[] {
  return (jobs || []).slice(0, Math.max(0, n)).reverse();
}

export const recentRunsOf = recentJobsOf;
