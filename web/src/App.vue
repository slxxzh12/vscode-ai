<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useTerminal } from './useTerminal';
import { useProjects } from './useProjects';
import { useCenter } from './useCenter';
import TerminalView from './components/TerminalView.vue';
import SessionList from './components/SessionList.vue';
import FileTree from './components/FileTree.vue';
import WorkflowPanel from './components/WorkflowPanel.vue';
import type { ProjectInfo } from '@devflow/shared';

const terminal = useTerminal({});
const center = useCenter();
const projectsApi = useProjects();
const projects = ref<ProjectInfo[]>([]);
const currentProject = ref<string | null>(null);
const rail = ref<'explorer' | 'sessions'>('explorer');
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
      <button class="wf-btn" @click="showWf = !showWf">⚡ Workflow ▾</button>
    </header>

    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" title="目录" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'sessions' }" title="会话" @click="rail = 'sessions'">▦</button>
      </aside>
      <aside class="side">
        <SessionList v-if="rail === 'sessions'" :terminal="terminal" :project-id="currentProject" />
        <FileTree v-else :project-id="currentProject" @open-file="openFile" />
      </aside>
      <section class="center">
        <TerminalView :terminal="terminal" :center="center" :project-id="currentProject" />
      </section>
    </div>

    <WorkflowPanel v-if="showWf" :terminal="terminal" @close="showWf = false" />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; position: relative; }
.top { display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px; background: #1a2027; border-bottom: 1px solid #2a323e; flex: none; }
.logo { color: #6aa2ff; font-weight: 700; }
.proj { color: #9aa4b2; font-size: 12px; }
.proj-sel { background: #222932; color: #d5dae1; border: 1px solid #2a323e; border-radius: 4px; padding: 2px 6px; }
.spacer { flex: 1; }
.wf-btn { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-weight: 600; }
.net { color: #eab308; font-size: 12px; }
.main { flex: 1; display: flex; min-height: 0; }
.activity { width: 40px; background: #161b21; border-right: 1px solid #2a323e; display: flex; flex-direction: column; align-items: center; padding-top: 6px; gap: 2px; flex: none; }
.a-btn { background: none; border: none; color: #6b7686; font-size: 17px; width: 34px; height: 30px; cursor: pointer; border-left: 2px solid transparent; }
.a-btn.on { color: #fff; border-left-color: #2f6feb; }
.side { width: 240px; background: #1a2027; border-right: 1px solid #2a323e; overflow: auto; flex: none; }
.center { flex: 1; min-width: 0; }
</style>
