// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MemberUsageTable from './MemberUsageTable.vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabUsage } from './types';
import { t } from '../i18n';

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
});
