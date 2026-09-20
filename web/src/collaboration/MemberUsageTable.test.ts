// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MemberUsageTable from './MemberUsageTable.vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabUsage } from './types';
import { t } from '../i18n';
import { fmtTime } from './usagePeers';

function mount(peers: Record<string, CollabUsage>, group: unknown = null) {
  const collab = { state: ref({ ...EMPTY_SNAPSHOT, group: group as never }) } as unknown as CollabApi;
  return mountC(MemberUsageTable, { props: { collab, peers, group: group as never }, global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

describe('MemberUsageTable', () => {
  it('渲染机器行与用量列', async () => {
    const now = Date.now();
    const w = mount({
      m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: '10.0.0.1', port: 22222, messages: 5, input: 10, output: 20, receivedAt: now },
    });
    await flushPromises();
    const rows = w.findAll('.el-table__row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('@10.0.0.1:22222');
  });

  it('成员不在群内时打标签', async () => {
    const w = mount(
      { m2: { agent: '*', days: 1, machineId: 'm2', username: 'bob', host: 'h', port: 1, messages: 1, receivedAt: Date.now() } },
      { id: 'g', name: 'G', hubId: 'h', createdAt: 1, members: [] },
    );
    await flushPromises();
    expect(w.text()).toContain('bob');
  });

  it('群主行显示群主徽标', async () => {
    const now = Date.now();
    const w = mount(
      { m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } },
      { id: 'g', name: 'G', hubId: 'm1', createdAt: 1, members: [{ machineId: 'm1' }, { machineId: 'm2' }] },
    );
    await flushPromises();
    expect(w.text()).toContain(t('collab.member.master'));
  });

  function mountWithIdentity(peers: Record<string, CollabUsage>, group: unknown, machineId: string) {
    const snap = { ...EMPTY_SNAPSHOT, group: group as never, identity: { ...EMPTY_SNAPSHOT.identity, machineId } };
    const collab = { state: ref(snap) } as unknown as CollabApi;
    return mountC(MemberUsageTable, { props: { collab, peers, group: group as never }, global: { plugins: [ElementPlus], stubs: { teleport: true } } });
  }

  it('自己所在行显示「我」徽标', async () => {
    const now = Date.now();
    const w = mountWithIdentity(
      { m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } },
      { id: 'g', name: 'G', hubId: 'hub2', createdAt: 1, members: [{ machineId: 'm1' }, { machineId: 'hub2' }] },
      'm1',
    );
    await flushPromises();
    const badge = w.find('.mebadge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(t('collab.member.me'));
  });

  it('展示最后一次数据更新时间列', async () => {
    const now = new Date(2026, 8, 20, 13, 54, 52).getTime();
    const w = mount({ m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } });
    await flushPromises();
    expect(w.text()).toContain(t('usage.last_report'));
    expect(w.text()).toContain(fmtTime(now));
  });

  it('导出成员 CSV 含最后更新时间', async () => {
    const now = new Date(2026, 8, 20, 13, 54, 52).getTime();
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const w = mount({ m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } });
    await flushPromises();
    await w.find('.mtool button').trigger('click');
    await flushPromises();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(String(body.zipName)).toContain('group-members');
    const csv = body.files[0].content as string;
    expect(csv).toContain('alice');
    expect(csv).toContain(fmtTime(now));
  });
});
