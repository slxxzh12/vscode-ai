<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const skills = ref<{ name: string }[]>([]);
const checked = ref<Record<string, boolean>>({});
const targetGroup = ref<string | null>(null);
const result = ref('');
const err = ref('');

onMounted(loadSkills);
watch(() => snap.value.groups, (groups) => {
  if (!targetGroup.value && groups.length) targetGroup.value = groups[0].id;
}, { deep: true });

async function loadSkills() {
  try { const r = await props.collab.listSkills(); skills.value = r.skills; }
  catch (e) { err.value = String((e as Error).message || e); }
}
async function distribute() {
  const names = Object.keys(checked.value).filter((n) => checked.value[n]);
  if (!names.length || !targetGroup.value) { result.value = '请先勾选技能并选择群'; return; }
  err.value = '';
  try {
    const r = await props.collab.distributeToGroup(targetGroup.value, names);
    const failures = (r as { failures?: unknown[] } | undefined)?.failures?.length ?? 0;
    result.value = `已推送到 ${(r as { pushed?: number } | undefined)?.pushed ?? 0} 个成员${failures ? `，失败 ${failures} 个` : ''}`;
  } catch (e) { err.value = String((e as Error).message || e); }
}
</script>

<template>
  <div class="sd">
    <h4>本机 skills</h4>
    <div v-if="skills.length === 0" class="empty">没有可分发技能（~/.config/opencode/skills 下需含 SKILL.md）</div>
    <label v-for="s in skills" :key="s.name" class="skill">
      <input type="checkbox" :value="s.name" v-model="checked[s.name]" />
      {{ s.name }}
    </label>
    <h4>分发给群</h4>
    <select v-model="targetGroup">
      <option v-for="g in snap.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
    </select>
    <button @click="distribute">⚡ 发起分发</button>
    <div v-if="result" class="ok">{{ result }}</div>
    <div v-if="err" class="err">{{ err }}</div>
  </div>
</template>

<style scoped>
.sd { padding: 14px; }
h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 12px 0 6px; }
.skill { display: block; padding: 4px 0; color: var(--tx); }
select { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; margin-right: 8px; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; }
.empty { color: var(--tx6); padding: 8px; }
.ok { color: var(--ok); margin-top: 8px; }
.err { color: var(--err); margin-top: 8px; }
</style>
