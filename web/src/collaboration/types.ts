export interface CollabProfile { machineId: string; username: string; employeeId?: string; host: string; port: number; publicKey: string; }
export interface CollabMember extends CollabProfile {}
export interface CollabGroup { id: string; name: string; hubId: string; createdAt: number; members: CollabMember[]; announcement?: string; }
export interface CollabInboxItem { id: string; fromId: string; groupId: string | null; kind?: 'skill' | 'file'; skillName: string | null; fileName?: string | null; hash: string; size: number; status: 'received' | 'installed' | 'ignored' | 'invalid'; receivedAt: number; }
export interface CollabGroupSkill { groupId: string; skillName: string; hash: string; distributedBy: string; installed: boolean; }
export interface CollabOutItem { id: string; kind: 'skill' | 'file'; groupId: string | null; skillName: string | null; fileName: string; size: number; hash: string; createdAt: number; }
export interface CollabUsage {
  agent: string; days: number;
  sessions?: number; messages?: number; totalCost?: number;
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  collectedAt?: number; receivedAt?: number; error?: string;
  machineId?: string; employeeId?: string; username?: string; host?: string; port?: number;
}
export interface CollabSnapshot {
  identity: CollabProfile;
  group: CollabGroup | null;
  groups: CollabGroup[];
  heartbeats: Record<string, CollabUsage>;
  skillsInbox: CollabInboxItem[];
  outbox: CollabOutItem[];
  groupSkills: CollabGroupSkill[];
}

export const EMPTY_SNAPSHOT: CollabSnapshot = {
  identity: { machineId: '', username: '', employeeId: '', host: '', port: 0, publicKey: '' },
  group: null, groups: [], heartbeats: {}, skillsInbox: [], outbox: [], groupSkills: [],
};

export interface CollabChatMeta { reqId: string | null; exitCode: number | null; stderr: string | null; durationMs: number | null; }
export type CollabChatKind = 'text' | 'cmd-result' | 'system';
export interface CollabChatMessage {
  id: string; groupId: string; kind: CollabChatKind;
  fromId: string; text: string; toId: string | null;
  meta: CollabChatMeta | null; ts: number; seq: number;
}
export interface CollabPendingCmd { id: string; groupId: string; fromId: string; text: string; receivedAt: number; }

export interface AssetManifestItem { name?: string; id?: string; label?: string; files?: number; hash?: string | null; stages?: number; }
export interface AssetManifestSource { machineId?: string; host?: string; port?: number; employeeId?: string; }
export interface AssetManifest {
  format: string; version: number; type: 'skills' | 'workflow' | 'mixed';
  exportedAt: number; source: AssetManifestSource | null;
  kinds: string[];
  skills: AssetManifestItem[]; command: AssetManifestItem[]; agent: AssetManifestItem[]; workflow: AssetManifestItem[];
}
export interface AssetManifestSummary {
  type: 'skills' | 'workflow' | 'mixed'; kinds: string[]; exportedAt: number;
  source: AssetManifestSource | null;
  counts: { skills: number; command: number; agent: number; workflow: number };
}
