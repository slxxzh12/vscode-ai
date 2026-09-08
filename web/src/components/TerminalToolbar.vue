<script setup lang="ts">
import type { useTerminal } from '../useTerminal';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();
function create() {
  props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
}
function kill(id: string) { if (confirm('结束该会话？')) props.terminal.killSession(id); }
</script>

<template>
  <div class="toolbar">
    <button class="tab" v-for="s in terminal.state.sessions" :key="s.id"
      :class="{ active: terminal.state.activeSessionId === s.id }"
      @click="terminal.switchTo(s.id)">
      <span :class="['dot', s.state]" />{{ s.name }}
      <span class="x" @click.stop="kill(s.id)">×</span>
    </button>
    <button class="new" @click="create">＋ 新建会话</button>
    <span v-if="terminal.state.status === 'reconnecting'" class="net">重连中…</span>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 4px; background: #141920; border-bottom: 1px solid #2a323e; padding: 0 8px; height: 32px; }
.tab { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: #9aa4b2; padding: 0 10px; height: 100%; cursor: pointer; border-right: 1px solid #2a323e; }
.tab.active { background: #0e1116; color: #e6e9ef; }
.tab .dot { width: 7px; height: 7px; border-radius: 50%; }
.dot.running { background: #22c55e; }
.dot.exited { background: #64748b; }
.tab .x { color: #5b6472; padding: 0 4px; }
.tab .x:hover { color: #fff; }
.new { background: none; border: none; color: #4c9aff; cursor: pointer; }
.net { margin-left: auto; color: #eab308; }
</style>
