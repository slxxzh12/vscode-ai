<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useTerminal } from './useTerminal';
import { useProjects } from './useProjects';
import { useCenter } from './useCenter';
import CollaborationView from './collaboration/CollaborationView.vue';
import TerminalView from './components/TerminalView.vue';
import SessionList from './components/SessionList.vue';
import FileTree from './components/FileTree.vue';
import WorkflowPanel from './components/WorkflowPanel.vue';
import type { ProjectInfo } from '@devflow/shared';
import { useTheme } from './theme';

const terminal = useTerminal({});
const center = useCenter();
const projectsApi = useProjects();
const { theme, toggle } = useTheme();
const projects = ref<ProjectInfo[]>([]);
const currentProject = ref<string | null>(null);
const rail = ref<'explorer' | 'sessions' | 'contacts'>('explorer');
const showWf = ref(false);

const projectName = computed(() => projects.value.find((p) => p.id === currentProject.value)?.name || '未选择项目');

async function loadProjects() {
  try { projects.value = await projectsApi.list(); } catch { projects.value = []; }
  if (!currentProject.value && projects.value.length) currentProject.value = projects.value[0].id;
}
function selectProject(id: string) { currentProject.value = id; }
function openFile(projectId: string, path: string, name: string) {
  center.openFile(projectId, path, name);
}
onMounted(() => {
  loadProjects();
  terminal.connect();
});
</script>

<template>
  <div class="app">
    <header class="top">
      <span class="logo">◈ devflow</span>
      <span class="proj">{{ projectName }}</span>
      <select v-if="projects.length" :value="currentProject || ''" class="proj-sel" @change="(e: any) => selectProject(e.target.value)">
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <div class="spacer" />
      <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
      <button class="theme-btn" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggle">{{ theme === 'dark' ? '☀' : '🌙' }}</button>
      <button class="wf-btn" @click="showWf = !showWf">⚡ Workflow ▾</button>
    </header>

    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" title="目录" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'sessions' }" title="会话" @click="rail = 'sessions'">▦</button>
        <button class="a-btn" :class="{ on: rail === 'contacts' }" title="通讯录" @click="rail = 'contacts'">👥</button>
      </aside>
      <template v-if="rail === 'contacts'">
        <section class="center">
          <CollaborationView :terminal="terminal" />
        </section>
      </template>
      <template v-else>
        <aside class="side">
          <SessionList v-if="rail === 'sessions'" :terminal="terminal" :project-id="currentProject" />
          <FileTree v-else :project-id="currentProject" @open-file="openFile" />
        </aside>
        <section class="center">
          <TerminalView :terminal="terminal" :center="center" :project-id="currentProject" />
        </section>
      </template>
    </div>

    <WorkflowPanel v-if="showWf" :terminal="terminal" @close="showWf = false" />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; position: relative; }
.top { display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px; background: var(--bg1); border-bottom: 1px solid var(--bd); flex: none; }
.logo { color: var(--ac3); font-weight: 700; }
.proj { color: var(--tx2); font-size: 12px; }
.proj-sel { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 6px; }
.spacer { flex: 1; }
.theme-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 14px; line-height: 1; }
.theme-btn:hover { border-color: var(--ac2); }
.wf-btn { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-weight: 600; }
.net { color: var(--warn); font-size: 12px; }
.main { flex: 1; display: flex; min-height: 0; }
.activity { width: 40px; background: var(--bg6); border-right: 1px solid var(--bd); display: flex; flex-direction: column; align-items: center; padding-top: 6px; gap: 2px; flex: none; }
.a-btn { background: none; border: none; color: var(--tx6); font-size: 17px; width: 34px; height: 30px; cursor: pointer; border-left: 2px solid transparent; }
.a-btn.on { color: var(--tx1); border-left-color: var(--ac); }
.side { width: 240px; background: var(--bg1); border-right: 1px solid var(--bd); overflow: auto; flex: none; }
.center { flex: 1; min-width: 0; }
</style>
