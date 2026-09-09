<script setup lang="ts">
import type { useTerminal } from '../useTerminal';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; projectId: string | null }>();
async function create() {
  const name = window.prompt('新会话名称(可空)');
  await props.terminal.createSession({ projectId: props.projectId, cols: 80, rows: 24 });
  void name;
}
</script>

<template>
  <div class="sl">
    <div class="head">
      <span>会话</span>
      <button class="plus" @click="create">＋ 新建</button>
    </div>
    <div class="item" v-for="s in terminal.state.sessions" :key="s.id"
      :class="{ active: terminal.state.activeSessionId === s.id }" @click="terminal.switchTo(s.id)">
      <span class="dot" :class="s.state" />
      <span class="nm">{{ s.name }}</span>
      <span v-if="s.state === 'exited'" class="exited-tag">已退出</span>
      <span class="kill" @click.stop="terminal.killSession(s.id)">×</span>
    </div>
    <div v-if="terminal.state.sessions.length === 0" class="empty">暂无会话，点上方新建</div>
  </div>
</template>

<style scoped>
.sl { padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.head { display: flex; justify-content: space-between; padding: 6px 8px; color: var(--tx2); text-transform: uppercase; font-size: 11px; }
.plus { background: none; border: none; color: var(--ac2); cursor: pointer; }
.item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-radius: 4px; color: var(--tx4); }
.item.active { background: var(--ac); color: var(--onac); }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.running { background: var(--ok); }
.dot.exited { background: var(--tx5); }
.nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exited-tag { font-size: 10px; color: var(--warn); }
.kill { color: transparent; padding: 0 3px; }
.item:hover .kill { color: var(--err); }
</style>
