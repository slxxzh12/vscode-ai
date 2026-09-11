import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollabS2C, CollabPeer } from '@devflow/shared/collab';

test('collab 常量可 import 且冻结', () => {
  assert.equal(CollabPeer.GROUP_JOIN, 'group-join');
  assert.equal(CollabS2C.COLLAB_INBOX, 'collab-inbox');
  assert.ok(Object.isFrozen(CollabS2C));
  assert.ok(Object.isFrozen(CollabPeer));
  // 两组枚举值不重叠，防路由错乱
  const s2c = Object.values(CollabS2C);
  const peer = Object.values(CollabPeer);
  for (const p of peer) assert.ok(!s2c.includes(p), `重叠: ${p}`);
  assert.equal(CollabPeer.CHAT_SEND, 'chat-send');
  assert.equal(CollabPeer.CMD_RESULT, 'cmd-result');
  assert.equal(CollabS2C.COLLAB_CHAT, 'collab-chat');
});
