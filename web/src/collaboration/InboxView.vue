<script setup lang="ts">
import { computed } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);

async function install(id: string) {
  if (!confirm('skill 含未知脚本，将安装到本机 ~/.config/opencode/skills。确认？')) return;
  await props.collab.installInbox(id); await props.collab.refresh();
}
async function ignore(id: string) { await props.collab.ignoreInbox(id); await props.collab.refresh(); }
async function remove(id: string) { if (confirm('删除该包？')) await props.collab.removeInbox(id); }
function fmtSize(n: number) { return n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
</script>

<template>
  <div class="ib">
    <div class="warn">⚠️ 收到的 skill 为未知代码，安装前请确认来源可信。</div>
    <div v-if="snap.skillsInbox.length === 0" class="empty">暂无收到的技能包</div>
    <div v-for="it in snap.skillsInbox" :key="it.id" class="item">
      <div class="info">
        <span class="nm">{{ it.skillName }}</span>
        <span class="meta">来自 {{ it.fromId.slice(0, 6) }} · {{ fmtSize(it.size) }} · {{ it.hash.slice(0, 8) }}</span>
      </div>
      <div class="acts">
        <template v-if="it.status === 'received'">
          <button @click="install(it.id)">安装</button>
          <button class="ghost" @click="ignore(it.id)">忽略</button>
        </template>
        <span v-else-if="it.status === 'installed'" class="state ok">已安装</span>
        <span v-else-if="it.status === 'ignored'" class="state">已忽略</span>
        <span v-else-if="it.status === 'invalid'" class="state bad">无效包</span>
        <button class="ghost del" @click="remove(it.id)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ib { padding: 14px; }
.warn { background: var(--warnbg); color: var(--warn); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
.item { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--bd2); padding: 8px 4px; }
.info { flex: 1; }
.nm { color: var(--tx1); font-weight: 600; }
.meta { color: var(--tx6); font-size: 11px; margin-left: 8px; font-family: monospace; }
.acts { display: flex; gap: 6px; align-items: center; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.del { color: var(--err); }
.state { font-size: 11px; color: var(--tx3); }
.state.ok { color: var(--ok); }
.state.bad { color: var(--err); }
.empty { color: var(--tx6); padding: 8px; }
</style>
