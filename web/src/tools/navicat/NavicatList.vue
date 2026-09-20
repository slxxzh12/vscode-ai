<script setup lang="ts">
import { computed, ref } from 'vue';
import type { NavicatProfile } from './useNavicat';

const props = defineProps<{ profiles: NavicatProfile[]; activeId: string }>();
const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'create'): void;
  (e: 'rename', id: string): void;
  (e: 'remove', id: string): void;
}>();

const q = ref('');
const list = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return props.profiles;
  return props.profiles.filter((p) => p.name.toLowerCase().includes(kw) || p.type.includes(kw));
});
</script>

<template>
  <aside class="nv-side">
    <div class="nv-sidehead">
      <span class="nv-sidetitle">{{ $t('tools.navicat') }}</span>
      <button class="nv-new" @click="emit('create')">＋</button>
    </div>
    <el-input v-model="q" class="nv-search" size="small" :placeholder="$t('nv.search_ph')" clearable />
    <div class="nv-list">
      <div
        v-for="p in list"
        :key="p.id"
        class="nv-row"
        :class="{ active: p.id === activeId }"
        @click="emit('select', p.id as string)"
      >
        <span class="nv-badge">{{ p.type }}</span>
        <span class="nv-name" :title="p.name">{{ p.name }}</span>
        <span class="nv-acts">
          <button class="nv-mini nv-rename" :title="$t('nv.rename')" @click.stop="emit('rename', p.id as string)">✎</button>
          <button class="nv-mini nv-del" :title="$t('nv.delete')" @click.stop="emit('remove', p.id as string)">🗑</button>
        </span>
      </div>
      <div v-if="!list.length" class="nv-empty">{{ $t('nv.empty') }}</div>
    </div>
  </aside>
</template>

<style scoped>
.nv-side { width: 260px; flex: none; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); padding: 6px; box-sizing: border-box; overflow: hidden; }
.nv-sidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; }
.nv-sidetitle { font-size: 12px; color: var(--tx3); }
.nv-new { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; width: 24px; height: 22px; cursor: pointer; }
.nv-new:hover { border-color: var(--ac2); color: var(--ac2); }
.nv-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.nv-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; cursor: pointer; font-size: 13px; color: var(--tx2); }
.nv-row:hover { background: var(--bg4); }
.nv-row.active { background: var(--bg4); color: var(--ac2); }
.nv-badge { flex: none; font-size: 10px; color: var(--tx4); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; text-transform: uppercase; }
.nv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nv-acts { display: none; gap: 2px; }
.nv-row:hover .nv-acts { display: flex; }
.nv-mini { background: none; border: none; color: var(--tx3); cursor: pointer; font-size: 12px; padding: 0 2px; }
.nv-mini:hover { color: var(--ac2); }
.nv-empty { color: var(--tx4); font-size: 12px; text-align: center; padding: 12px 0; }
</style>
