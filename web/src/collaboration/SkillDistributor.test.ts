// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import SkillDistributor from './SkillDistributor.vue';
import { EMPTY_SNAPSHOT } from './types';

const AGENTS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', skillsDir: '/home/u/.config/opencode/skills', exists: true, selectable: true, selected: true },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode', skillsDir: '/home/u/.claude/skills', exists: false, selectable: true, selected: false },
];

function mockCollab() {
  const setTool = vi.fn(async (agentId: string) => ({
    code: 'ok',
    root: AGENTS.find((a) => a.id === agentId)?.skillsDir || '',
    selected: agentId,
    agents: AGENTS.map((a) => ({ ...a, selected: a.id === agentId })),
    tool: { agentId, customRoot: null },
  }));
  const getAssets = vi.fn(async () => ({ skills: [{ name: 's1' }], command: [], agent: [], workflow: [] }));
  return {
    state: { value: { ...EMPTY_SNAPSHOT, groups: [] } },
    getTool: vi.fn(async () => ({ tool: { agentId: 'opencode', customRoot: null }, root: AGENTS[0].skillsDir, selected: 'opencode', agents: AGENTS })),
    setTool,
    getAssets,
    getWorkflowSeed: vi.fn(async () => ({ version: 1, workflows: [] })),
    buildPackage: vi.fn(),
    publishPackage: vi.fn(),
    uploadPackage: vi.fn(),
  };
}

function mount(collab: any) {
  return mountC(SkillDistributor, {
    props: { collab, groupId: 'g1', focus: 'skills', open: true },
    global: {
      plugins: [ElementPlus],
      stubs: { teleport: true, 'el-dialog': { template: '<div><slot /></div>' } },
    },
  });
}

afterEach(() => { localStorage.clear(); });

describe('SkillDistributor agent selector', () => {
  it('列出各 agent 及其 skills 目录', async () => {
    const w = mount(mockCollab());
    await flushPromises();
    const txt = w.text();
    expect(txt).toContain('OpenCode');
    expect(txt).toContain('/home/u/.config/opencode/skills');
    expect(txt).toContain('/home/u/.claude/skills');
  });

  it('切换 agent 调 setTool 并重新加载资产', async () => {
    const collab = mockCollab();
    const w = mount(collab);
    await flushPromises();
    expect(collab.getAssets).toHaveBeenCalledTimes(1);
    const radios = w.findAll('input[name="dist-agent"]');
    await radios[1].setValue();
    await flushPromises();
    expect(collab.setTool).toHaveBeenCalledWith('claudecode', null);
    expect(collab.getAssets).toHaveBeenCalledTimes(2);
  });

  it('群主一步打包并生成种子', async () => {
    const collab: any = mockCollab();
    collab.state.value = {
      ...EMPTY_SNAPSHOT,
      identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' },
      groups: [{ id: 'g1', hubId: 'me', name: 'G', createdAt: 0, members: [] }],
    };
    collab.buildPackage.mockResolvedValue({ package: { id: 'p1', fileName: 'a.zip', size: 1 } });
    collab.publishPackage.mockResolvedValue({ code: 'ok', version: 'v1' });
    const w = mount(collab);
    await flushPromises();
    await w.find('input[type="checkbox"]').setValue(true);
    await w.find('button.go').trigger('click');
    await flushPromises();
    expect(collab.buildPackage).toHaveBeenCalled();
    expect(collab.publishPackage).toHaveBeenCalledWith('p1');
    expect(collab.uploadPackage).not.toHaveBeenCalled();
  });

  it('非群主一步打包并上传给群主', async () => {
    const collab: any = mockCollab();
    collab.state.value = {
      ...EMPTY_SNAPSHOT,
      identity: { ...EMPTY_SNAPSHOT.identity, machineId: 'me' },
      groups: [{ id: 'g1', hubId: 'other', name: 'G', createdAt: 0, members: [] }],
    };
    collab.buildPackage.mockResolvedValue({ package: { id: 'p1', fileName: 'a.zip', size: 1 } });
    collab.uploadPackage.mockResolvedValue({ code: 'ok', packageId: 'mp1' });
    const w = mount(collab);
    await flushPromises();
    await w.find('input[type="checkbox"]').setValue(true);
    await w.find('button.go').trigger('click');
    await flushPromises();
    expect(collab.uploadPackage).toHaveBeenCalledWith('p1', 'g1');
    expect(collab.publishPackage).not.toHaveBeenCalled();
  });
});
