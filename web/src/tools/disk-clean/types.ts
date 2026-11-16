export type DiskGroup = 'system' | 'app' | 'browser' | 'custom';
export type DiskRisk = 'safe' | 'caution' | 'risky';
export type DiskStatus = 'pending' | 'scanning' | 'done' | 'error';

export interface DiskCategory {
  id: string;
  group: DiskGroup;
  risk: DiskRisk;
  defaultChecked: boolean;
  needsAdmin: boolean;
  minAgeDays?: number;
  status: DiskStatus;
  bytes: number;
  files: number;
  truncated: boolean;
  error: string | null;
}

export interface DiskScan {
  id: string;
  startedAt: number;
  categories: DiskCategory[];
}

export interface DiskSettings {
  exclusions: { dirs: string[]; patterns: string[] };
  customDirs: string[];
}

export interface DiskCleanResult {
  status: 'running' | 'done' | 'cancelled' | 'error' | 'interrupted';
  removed?: number;
  bytes?: number;
  skipped?: number;
  failed?: Array<{ path: string; reason: string }>;
  mode?: 'recycle' | 'permanent';
  elevated?: boolean;
  error?: string;
}
