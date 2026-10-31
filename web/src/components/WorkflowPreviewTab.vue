<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { groupBands, type Workflow } from '../workflowModel';

const props = defineProps<{ model: Workflow[] }>();
const wfIndex = ref(0);
watch(() => props.model.length, () => { if (wfIndex.value >= props.model.length) wfIndex.value = 0; });

const current = computed<Workflow | null>(() => props.model[wfIndex.value] || null);
const bands = computed(() => (current.value ? groupBands(current.value.stages) : []));
const stageIndex = ref(0);
watch(current, () => { stageIndex.value = 0; });
const chips = computed<string[]>(() => current.value?.stages[stageIndex.value]?.prompts || []);

function chipText(s: string) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? one.slice(0, 40) + '…' : one;
}
function flatIndex(start: number, offset: number) { return start + offset; }
</script>

<template>
  <div class="pv">
    <div v-if="!current" class="empty">{{ $t('wfe.preview.empty') }}</div>
    <template v-else>
      <div class="wfbtns">
        <button v-for="(w, i) in model" :key="w.id" class="wfbtn" :class="{ on: i === wfIndex }" @click="wfIndex = i">{{ w.label }}</button>
      </div>
      <div class="flowbar">
        <template v-for="(g, gi) in bands" :key="gi">
          <div class="fgroup">
            <span v-if="g.name" class="fglabel">{{ g.name }}</span>
            <template v-for="(s, i) in g.stages" :key="s.id">
              <button class="stage" :class="{ on: stageIndex === flatIndex(g.startIndex, i) }" @click="stageIndex = flatIndex(g.startIndex, i)">{{ s.label }}</button>
              <span v-if="i < g.stages.length - 1" class="flowline" />
            </template>
          </div>
          <span v-if="gi < bands.length - 1" class="fgap" />
        </template>
      </div>
      <div v-if="chips.length" class="chipbar">
        <span class="chips-label">{{ $t('wfe.preview.current') }}</span>
        <span v-for="(p, i) in chips" :key="i" class="chip" :title="p"><span class="cdot" />{{ chipText(p) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pv { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px; }
.empty { color: var(--tx3); font-size: 13px; }
.wfbtns { display: flex; gap: 6px; flex-wrap: wrap; }
.wfbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.wfbtn.on { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.flowbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.fgroup { display: flex; align-items: center; gap: 4px; }
.fglabel { color: var(--tx3); font-size: 11px; margin-right: 4px; }
.stage { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 1px 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
.stage.on { border-color: var(--ac2); color: var(--ac2); }
.flowline { width: 14px; height: 1px; background: var(--bd); display: inline-block; }
.fgap { width: 18px; }
.chipbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: var(--bg3); border: 1px solid var(--bd2); border-radius: 6px; padding: 6px 8px; }
.chips-label { color: var(--tx3); font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg1); border: 1px solid var(--bd); border-radius: 12px; padding: 2px 10px; font-size: 12px; color: var(--tx2); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdot { width: 6px; height: 6px; border-radius: 50%; background: var(--ac2); flex: none; }
</style>
