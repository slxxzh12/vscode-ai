// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import DistTaskNotifier from './DistTaskNotifier.vue';
import { t } from '../i18n';

const TASK = { id: 't1', groupId: 'g1', kind: 'skills', hash: 'h1', name: 'skills/a.zip', status: 'pending', payload: { skills: ['a'] } };

function mockCollab(tasks: unknown[] = [TASK]) {
  return {
    state: { value: null },
    refresh: vi.fn(async () => ({})),
    listTasks: vi.fn(async () => ({ tasks })),
    acceptTask: vi.fn(async () => ({ code: 'ok' })),
    ignoreTask: vi.fn(async () => ({ code: 'ignored' })),
  };
}
function mockTerminal() { return { on: vi.fn(() => () => {}) }; }

afterEach(() => { vi.restoreAllMocks(); });

describe('DistTaskNotifier', () => {
  it('有 pending 任务时弹窗显示，确认调 acceptTask', async () => {
    const collab = mockCollab();
    const w = mountC(DistTaskNotifier, {
      props: { collab: collab as never, terminal: mockTerminal() as never },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    expect(w.text()).toContain('skills/a.zip');
    const accept = w.findAll('button').find((b) => b.text().includes(t('collab.dist.task_popup.accept')));
    expect(accept).toBeTruthy();
    await accept!.trigger('click');
    await flushPromises();
    expect(collab.acceptTask).toHaveBeenCalledWith('t1');
  });

  it('拒绝调 ignoreTask', async () => {
    const collab = mockCollab();
    const w = mountC(DistTaskNotifier, {
      props: { collab: collab as never, terminal: mockTerminal() as never },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    const reject = w.findAll('button').find((b) => b.text().includes(t('collab.dist.task_popup.reject')));
    await reject!.trigger('click');
    await flushPromises();
    expect(collab.ignoreTask).toHaveBeenCalledWith('t1');
  });

  it('upload 任务用「收到成员上传」标题与「接受并发布」按钮', async () => {
    const upload = { id: 'u1', groupId: 'g1', kind: 'upload', hash: 'h9', name: 'assets.zip', status: 'pending', payload: { skills: ['a'] } };
    const collab = mockCollab([upload]);
    const w = mountC(DistTaskNotifier, {
      props: { collab: collab as never, terminal: mockTerminal() as never },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    expect(w.text()).toContain(t('collab.dist.task_popup.title_upload'));
    const accept = w.findAll('button').find((b) => b.text().includes(t('collab.dist.task_popup.accept_upload')));
    expect(accept).toBeTruthy();
  });
});
