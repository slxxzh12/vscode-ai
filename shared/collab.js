// 协作子系统独立常量（勿并入 shared/index.js，避免与 master 冲突）
export const CollabS2C = Object.freeze({
  COLLAB_INBOX: 'collab-inbox',
  COLLAB_FRIEND_REQ: 'collab-friend-req',
  COLLAB_GROUP_INVITE: 'collab-group-invite',
  COLLAB_SYNCED: 'collab-synced',
});
export const CollabPeer = Object.freeze({
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPT: 'friend-accept',
  GROUP_INVITE: 'group-invite',
  GROUP_ACCEPT: 'group-accept',
  MEMBER_SYNC: 'member-sync',
  SKILL_PUSH: 'skill-push',
  PULL_SYNC: 'pull-sync',
});
