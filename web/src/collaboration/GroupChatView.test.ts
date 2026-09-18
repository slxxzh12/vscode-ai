// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { mountC } from '../test-utils';
import GroupChatView from './GroupChatView.vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabChatMessage, CollabGroup } from './types';
import { t } from '../i18n';

function mountChat(messages: CollabChatMessage[]) {
  const group: CollabGroup = {
    id: 'g', name: 'G', hubId: 'hub', createdAt: 1,
    members: [
      { machineId: 'me', username: 'alice', host: 'h', port: 1, publicKey: 'k' },
      { machineId: 'hub', username: 'bob', host: 'h', port: 2, publicKey: 'k2' },
    ],
  };
  const snap = { ...EMPTY_SNAPSHOT, identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' }, groups: [group], group };
  const collab = {
    state: ref(snap),
    chatState: ref({ g: { messages } }),
    pendingCmdState: ref([]),
    chat: async () => {},
    pullChat: async () => {},
    loadPendingCmds: async () => {},
  } as unknown as CollabApi;
  return mountC(GroupChatView, { props: { collab, groupId: 'g' } });
}

const msg = (over: Partial<CollabChatMessage>): CollabChatMessage => ({
  id: 'x', groupId: 'g', kind: 'text', fromId: 'me', text: 'hi', toId: null, meta: null, ts: 1, seq: 1, ...over,
});

describe('GroupChatView 身份标识', () => {
  it('群主消息显示用户名与群主徽标', async () => {
    const w = mountChat([msg({ id: 'a', fromId: 'hub', text: 'from hub' })]);
    await flushPromises();
    const meta = w.find('.msg .meta');
    expect(meta.text()).toContain('bob');
    expect(meta.text()).toContain(t('collab.member.master'));
  });

  it('自己消息显示用户名与我徽标', async () => {
    const w = mountChat([msg({ id: 'b', fromId: 'me', text: 'from me' })]);
    await flushPromises();
    const meta = w.find('.msg .meta');
    expect(meta.text()).toContain('alice');
    expect(meta.text()).toContain(t('collab.chat.me'));
  });
});
