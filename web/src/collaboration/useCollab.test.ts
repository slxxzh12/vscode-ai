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
