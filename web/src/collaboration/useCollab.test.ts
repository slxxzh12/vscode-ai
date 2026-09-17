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
      group: null, heartbeats: {}, skillsInbox: [], groupSkills: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(snap));
    const c = useCollab();
    await c.refresh();
    expect(c.state.value?.identity.machineId).toBe('m');
  });

  it('join 带 host/port/token POST 到 /join', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'joined' }));
    const c = useCollab();
    const r = await c.join('192.168.1.5', 3001, 'tok');
    expect(r).toEqual({ code: 'joined' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/collab/join');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ host: '192.168.1.5', port: 3001, token: 'tok' });
  });

  it('installInbox 打到正确路由', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'installed' }));
    const c = useCollab();
    await c.installInbox('in-1');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/inbox/in-1/install');
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

  it('handleS2C(collab-cmd-pending) 拉取待确认命令', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ pending: [{ id: 'c1' }] }));
    const c = useCollab();
    await c.handleS2C('collab-cmd-pending', {});
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/cmds');
    expect(c.pendingCmdState.value).toHaveLength(1);
  });

  it('pullChat 合并去重并按 seq 排序', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'ok', messages: [{ id: 'm2', seq: 2 }, { id: 'm1', seq: 1 }] }));
    const c = useCollab();
    await c.pullChat('g1', 'm1');
    expect(c.chatState.value['g1'].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('refresh 失败写入 lastError 并抛出', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ error: 'boom' }, false));
    const c = useCollab();
    await expect(c.refresh()).rejects.toThrow('boom');
    expect(c.lastError.value).toBe('boom');
  });

  it('其余端点走正确方法/路由（含查询串拼接）', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonRes({});
    }) as typeof fetch);
    const c = useCollab();
    await c.updateIdentity('h', 1, 'e');
    await c.setAnnouncement('a');
    await c.syncDownloads();
    await c.listDownloads();
    await c.getUpdate();
    await c.publishUpdate(['a.md']);
    await c.checkUpdate();
    await c.listRemoteFiles('m1');
    await c.listRemoteFiles();
    await c.pullDownloads(['a']);
    await c.applyUpdate('m1', 'accept');
    await c.listSkills();
    await c.getTool();
    await c.setTool('opencode');
    await c.getAssets();
    await c.buildPackage({ skills: ['s'] });
    await c.getWorkflowSeed();
    await c.sendPackage('p1', 'g1');
    await c.publishPackage('p1');
    await c.installDownload('a.md');
    await c.listTasks('pending');
    await c.listTasks();
    await c.acceptTask('t1');
    await c.ignoreTask('t1');
    await c.getDirs();
    await c.distributeToGroup('g1', ['s']);
    await c.ignoreInbox('i1');
    await c.removeInbox('i1');
    await c.removeOutTask('o1');
    await c.loadPendingCmds();
    const urls = calls.map((x) => x.url);
    expect(urls).toContain('/api/collab/downloads/remote?masterId=m1');
    expect(urls).toContain('/api/collab/downloads/remote');
    expect(urls).toContain('/api/collab/tasks?status=pending');
    expect(urls).toContain('/api/collab/tasks');
    expect(urls).toContain('/api/collab/inbox/i1');
    expect(urls).toContain('/api/collab/outbox/o1');
    expect(calls.find((x) => x.url === '/api/collab/inbox/i1')?.init?.method).toBe('DELETE');
  });

  it('sendGroupFile：超 40MB 抛错；失败读 error；成功回 body', async () => {
    const c = useCollab();
    await expect(c.sendGroupFile('g1', 'f.bin', { size: 41 * 1024 * 1024 } as Blob)).rejects.toThrow();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ error: 'bad file' }, false));
    await expect(c.sendGroupFile('g1', 'f.bin', { size: 1 } as Blob)).rejects.toThrow('bad file');

    fetchSpy.mockResolvedValue(jsonRes({ code: 'ok' }));
    await expect(c.sendGroupFile('g1', 'f.bin', { size: 1 } as Blob)).resolves.toEqual({ code: 'ok' });
  });
});
