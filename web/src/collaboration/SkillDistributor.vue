<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi; groupId: string }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => snap.value.groups.find((g) => g.id === props.groupId) || null);
const skills = ref<{ name: string }[]>([]);
const checked = ref<Record<string, boolean>>({});
const result = ref('');
const err = ref('');
const sending = ref(false);

onMounted(loadSkills);

async function loadSkills() {
  try { const r = await props.collab.listSkills(); skills.value = r.skills; }
  catch (e) { err.value = String((e as Error).message || e); }
}
async function distribute() {
  const names = Object.keys(checked.value).filter((n) => checked.value[n]);
  if (!names.length) { result.value = '请先勾选技能'; return; }
  err.value = '';
  sending.value = true;
  try {
    const r = await props.collab.distributeToGroup(props.groupId, names);
    const failures = (r as { failures?: unknown[] } | undefined)?.failures?.length ?? 0;
    result.value = `已推送到 ${(r as { pushed?: number } | undefined)?.pushed ?? 0} 个成员${failures ? `，失败 ${failures} 个` : ''}`;
  } catch (e) { err.value = String((e as Error).message || e); }
  finally { sending.value = false; }
}
</script>

<template>
  <div class="sd">
    <div class="head">🛠 分发技能 <span class="gn">{{ group?.name || '' }}</span></div>
    <div v-if="skills.length === 0" class="empty">没有可分发技能（~/.config/opencode/skills 下需含 SKILL.md）</div>
    <label v-for="s in skills" :key="s.name" class="skill">
      <input type="checkbox" :value="s.name" v-model="checked[s.name]" />
      {{ s.name }}
    </label>
    <div class="acts">
      <button :disabled="sending || skills.length === 0" @click="distribute">{{ sending ? '分发中…' : '⚡ 发起分发' }}</button>
      <div v-if="result" class="ok">{{ result }}</div>
    </div>
    <div v-if="err" class="err">{{ err }}</div>
  </div>
</template>

<style scoped>
.sd { padding: 10px 12px; background: var(--bg1); border-top: 1px solid var(--bd2); }
.head { font-size: 12px; font-weight: 600; color: var(--tx2); margin-bottom: 8px; }
.gn { color: var(--ac2); font-weight: 700; }
.skill { display: block; padding: 3px 0; color: var(--tx); font-size: 13px; }
.skill input { margin-right: 6px; }
.empty { color: var(--tx6); padding: 4px 0 8px; font-size: 12px; }
.acts { margin-top: 8px; display: flex; gap: 10px; align-items: center; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
.ok { color: var(--ok); font-size: 12px; }
.err { color: var(--err); margin-top: 8px; font-size: 12px; }
</style>
