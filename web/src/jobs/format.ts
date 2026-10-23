import { t } from '../i18n';

export const JOB_STATUS_LABEL: Record<number, string> = {
  0: 'jobs.status.queued', 1: 'jobs.status.success', 2: 'jobs.status.failed',
  3: 'jobs.status.running', 4: 'jobs.status.pending',
};
export function jobStatusLabel(s: number): string { return t(JOB_STATUS_LABEL[s] || 'jobs.status.failed'); }
export function jobStatusClass(s: number): string {
  return s === 1 ? 'ok' : s === 2 ? 'bad' : s === 3 ? 'run' : s === 4 ? 'wait' : 'queue';
}
