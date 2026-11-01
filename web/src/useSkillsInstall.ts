import { ref } from 'vue';

export interface SkillTargetStatus {
  id: string;
  label: string;
  dir: string;
  exists: boolean;
  detected: boolean;
  total: number;
  missing: string[];
}

export interface SkillsStatus {
  skills: string[];
  targets: SkillTargetStatus[];
  missing: number;
  startupPrompt?: boolean;
}

export interface SkillTargetResult {
  id: string;
  label: string;
  dir: string;
  total: number;
  installed: string[];
  skipped: string[];
  errors: { id: string; error: string }[];
}

export interface SkillsInstallResult {
  skills: number;
  installed: number;
  targets: SkillTargetResult[];
}

const status = ref<SkillsStatus | null>(null);
const installing = ref(false);

function query(sessionId = '', startup = false): string {
  const q = new URLSearchParams();
  if (sessionId) q.set('sessionId', sessionId);
  if (startup) q.set('startup', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function loadSkillsStatus(sessionId = '', startup = false): Promise<SkillsStatus | null> {
  try {
    const r = await fetch(`/api/skills/status${query(sessionId, startup)}`);
    if (!r.ok) return null;
    status.value = (await r.json()) as SkillsStatus;
    return status.value;
  } catch {
    return null;
  }
}

export async function installMissingSkills(
  sessionId = '',
  targets: string[] | null = null,
): Promise<SkillsInstallResult | null> {
  installing.value = true;
  try {
    const r = await fetch('/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, targets }),
    });
    if (!r.ok) return null;
    const out = (await r.json()) as SkillsInstallResult;
    await loadSkillsStatus(sessionId);
    return out;
  } catch {
    return null;
  } finally {
    installing.value = false;
  }
}

export function useSkillsInstall() {
  return { status, installing, loadSkillsStatus, installMissingSkills };
}
