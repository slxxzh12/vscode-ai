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
.warn { background: #3a2a12; color: #eab308; border: 1px solid #4a3a1a; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
.item { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #232b34; padding: 8px 4px; }
.info { flex: 1; }
.nm { color: #e2e8f0; font-weight: 600; }
.meta { color: #6b7686; font-size: 11px; margin-left: 8px; font-family: monospace; }
.acts { display: flex; gap: 6px; align-items: center; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid #2a323e; color: #9aa4b2; }
button.del { color: #ff6b6b; }
.state { font-size: 11px; color: #9aa4b2; }
.state.ok { color: #22c55e; }
.state.bad { color: #ff6b6b; }
.empty { color: #6b7686; padding: 8px; }
</style>
