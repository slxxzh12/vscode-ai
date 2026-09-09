import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCollab } from './useCollab';

function jsonRes(obj: unknown, ok = true) {
  return { ok, json: async () => obj } as unknown as Response;
}
afterEach(() => vi.restoreAllMocks());

describe('useCollab', () => {
  it('refresh 拉取 snapshot 并写入 state', async () => {
    const snap = {
      identity: { machineId: 'm', username: 'u', host: 'h', port: 1, publicKey: 'k' },
      friends: [], pendingFriends: [], groups: [], pendingInvites: [], skillsInbox: [], groupSkills: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(snap));
    const c = useCollab();
    await c.refresh();
    expect(c.state.value?.identity.machineId).toBe('m');
  });

  it('requestFriend 带 host/port POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'requested' }));
    const c = useCollab();
    const r = await c.requestFriend('192.168.1.5', 3001);
    expect(r).toEqual({ code: 'requested' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/collab/friends');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ host: '192.168.1.5', port: 3001 });
  });

  it('installInbox 打到正确路由', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'installed' }));
    const c = useCollab();
    await c.installInbox('in-1');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/inbox/in-1/install');
  });

  it('kickMember 打到 members/kick 路由', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'kicked' }));
    const c = useCollab();
    await c.kickMember('g1', 'target');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g1/members/target/kick');
  });
});


describe('useCollab chat', () => {
  it('chat() 返回消息并写入 chatState', async () => {
    const msgs = [{ id: 'm1', groupId: 'g1', kind: 'text', fromId: 'a', text: 'hi', toId: null, meta: null, ts: 1, seq: 1 }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ messages: msgs }));
    const c = useCollab();
    await c.chat('g1');
    expect(c.chatState.value['g1'].messages.length).toBe(1);
  });

  it('sendChat POST 到 /groups/:gid/chat', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ messages: [] }));
    const c = useCollab();
    await c.sendChat('g1', 'hello', null);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/collab/groups/g1/chat');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'hello', toId: null });
  });

  it('sendCmd 触发到 /groups/:gid/cmd', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'sent', reqId: 'r1' }));
    const c = useCollab();
    await c.sendCmd('g1', 'go', 'b-id');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g1/cmd');
  });

  it('approveCmd 打到 /cmds/:reqId/approve', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'approved' }));
    const c = useCollab();
    await c.approveCmd('r1', true);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/cmds/r1/approve');
  });

  it('handleS2C(COLLAB_CHAT) 触发 chat 重新拉取', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ messages: [] }));
    const c = useCollab();
    await c.handleS2C('collab-chat', { groupId: 'g9' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g9/chat');
  });
});
