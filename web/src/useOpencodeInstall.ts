import { ref } from 'vue';

export interface InstalledAgent {
  cmd: string;
  path: string;
}

export interface OpencodeDownload {
  state: 'idle' | 'downloading' | 'done' | 'error';
  downloaded: number;
  total: number;
  percent: number;
  error: string;
  path: string;
  userPath: boolean;
  startedAt: number;
  finishedAt: number;
}

export interface OpencodeStatus {
  supported: boolean;
  platform: string;
  arch: string;
  anyInstalled: boolean;
  installed: InstalledAgent[];
  target: string;
  downloadUrl: string;
  download: OpencodeDownload;
}

const status = ref<OpencodeStatus | null>(null);
const installing = ref(false);

export async function fetchOpencodeStatus(): Promise<OpencodeStatus | null> {
  try {
    const response = await fetch('/api/opencode/status');
    if (!response.ok) return null;
    status.value = (await response.json()) as OpencodeStatus;
    return status.value;
  } catch {
    return null;
  }
}

export async function startOpencodeInstall(): Promise<OpencodeStatus | null> {
  installing.value = true;
  try {
    const response = await fetch('/api/opencode/install', { method: 'POST' });
    if (!response.ok) return null;
    status.value = (await response.json()) as OpencodeStatus;
    return status.value;
  } catch {
    return null;
  } finally {
    installing.value = false;
  }
}

export function useOpencodeInstall() {
  return { status, installing, fetchOpencodeStatus, startOpencodeInstall };
}
