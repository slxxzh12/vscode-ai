export interface CollabProfile { machineId: string; username: string; host: string; port: number; publicKey: string; }
export interface CollabFriend extends CollabProfile { addedAt?: number; }
export interface CollabMember extends CollabProfile { role: 'owner' | 'admin' | 'member'; }
export interface CollabGroup { id: string; name: string; ownerId: string | null; createdAt: number; members: CollabMember[]; }
export interface CollabInboxItem { id: string; fromId: string; groupId: string | null; skillName: string; hash: string; size: number; status: 'received' | 'installed' | 'ignored' | 'invalid'; receivedAt: number; }
export interface CollabGroupSkill { groupId: string; skillName: string; hash: string; distributedBy: string; installed: boolean; }
export interface CollabPendingFriend extends CollabProfile { requestedAt?: number; }
export interface CollabInvite { id: string; groupId: string; groupName: string; inviter: CollabProfile; receivedAt?: number; }
export interface CollabSnapshot {
  identity: CollabProfile;
  friends: CollabFriend[];
  pendingFriends: CollabPendingFriend[];
  groups: CollabGroup[];
  pendingInvites: CollabInvite[];
  skillsInbox: CollabInboxItem[];
  groupSkills: CollabGroupSkill[];
}

export const EMPTY_SNAPSHOT: CollabSnapshot = {
  identity: { machineId: '', username: '', host: '', port: 0, publicKey: '' },
  friends: [], pendingFriends: [], groups: [], pendingInvites: [], skillsInbox: [], groupSkills: [],
};

export interface CollabChatMeta { reqId: string | null; exitCode: number | null; stderr: string | null; durationMs: number | null; }
export type CollabChatKind = 'text' | 'cmd-result' | 'system';
export interface CollabChatMessage {
  id: string; groupId: string; kind: CollabChatKind;
  fromId: string; text: string; toId: string | null;
  meta: CollabChatMeta | null; ts: number; seq: number;
}
export interface CollabPendingCmd { id: string; groupId: string; fromId: string; text: string; receivedAt: number; }
