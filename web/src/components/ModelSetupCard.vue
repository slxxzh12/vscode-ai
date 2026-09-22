<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLlm } from '../useLlm';
import { LLM_PROVIDER_PRESETS, isVisionModel } from '@devflow/shared/llm-presets';
import type { OpencodeConfigFile } from '../opencodeConfig';
import { providersFromConfig, addablePresets, buildProviders, modelOptions, type ConfiguredProvider } from '../llmPresets';

const emit = defineEmits<{ (e: 'saved'): void }>();
const api = useLlm();
const file = ref<OpencodeConfigFile | null>(null);
const providers = ref<ConfiguredProvider[]>([]);
const originalIds = ref<Set<string>>(new Set());
const removed = ref<string[]>([]);
const model = ref('');
const err = ref('');
const saved = ref(false);
const skipped = ref<string[]>([]);
const revealed = ref<Set<number>>(new Set());   // 已点开明的 ApiKey 行下标

const presets = LLM_PROVIDER_PRESETS;
const options = computed(() => modelOptions(providers.value));
const invalid = computed(() => !!file.value && file.value.exists && file.value.config === null);
const addable = computed(() => addablePresets(providers.value, presets));
const isPreset = (id: string) => !!presets.find((p) => p.id === id);
const presetModels = (id: string) => presets.find((p) => p.id === id)?.models || [];

function applyFile(f: OpencodeConfigFile) {
  file.value = f;
  providers.value = providersFromConfig(f.config, presets);
  originalIds.value = new Set(providers.value.map((p) => p.id));
  removed.value = [];
  model.value = f.config && typeof f.config.model === 'string' ? f.config.model : '';
}
async function load() {
  err.value = '';
  saved.value = false;
  skipped.value = [];
  try { applyFile(await api.opencodeConfig()); } catch (e: any) { err.value = e?.message || String(e); }
}
onMounted(load);

function onAdd(e: Event) {
  const el = e.target as HTMLSelectElement;
  const v = el.value;
  el.value = '';
  if (!v) return;
  const preset = presets.find((p) => p.id === v);
  if (preset) {
    providers.value.push({ id: preset.id, name: preset.name, baseURL: preset.baseURL, custom: false, hasKey: false, apiKey: '', keyOriginal: '', models: [], extraModels: '' });
  } else {
    providers.value.push({ id: '', name: '', baseURL: '', custom: true, hasKey: false, apiKey: '', keyOriginal: '', models: [], extraModels: '' });
  }
}
function removeProvider(i: number) {
  const p = providers.value[i];
  if (originalIds.value.has(p.id)) removed.value.push(p.id);
  providers.value.splice(i, 1);
  if (p.id && model.value.startsWith(`${p.id}/`)) model.value = '';
}
function toggleReveal(i: number) {
  const next = new Set(revealed.value);
  if (next.has(i)) next.delete(i); else next.add(i);
  revealed.value = next;
}
function toggle(s: ConfiguredProvider, mid: string) {
  const i = s.models.indexOf(mid);
  if (i >= 0) s.models.splice(i, 1); else s.models.push(mid);
}
async function save() {
  err.value = '';
  try {
    const r = await api.saveOpencodeConfig({ providers: buildProviders(providers.value), remove: removed.value, model: model.value.trim() });
    skipped.value = r.skipped || [];
    await load();
    saved.value = true;
    emit('saved');
  } catch (e: any) { err.value = e?.message || String(e); }
}
</script>

<template>
  <section class="card">
    <div class="ch">{{ $t('llm.setup.title') }}
      <span class="row">
        <button class="ghost" @click="load">{{ $t('llm.setup.reload') }}</button>
        <button :disabled="invalid" @click="save">{{ saved ? $t('llm.setup.saved') : $t('llm.setup.save') }}</button>
      </span>
    </div>
    <div class="muted">{{ $t('llm.setup.file', { path: file?.path || '' }) }}</div>
    <div v-if="file && !file.exists" class="muted">{{ $t('llm.setup.missing') }}</div>
    <div v-if="invalid" class="warn">{{ $t('llm.setup.invalid') }}</div>
    <div v-if="file?.format === 'jsonc'" class="muted">{{ $t('llm.setup.jsonc_hint') }}</div>
    <div v-if="err" class="err">{{ err }}</div>
    <div v-for="id in skipped" :key="id" class="warn">{{ $t('llm.setup.need_key', { id }) }}</div>

    <div class="row">
      <span class="muted">{{ $t('llm.setup.default_model') }}</span>
      <select v-model="model">
        <option value="">{{ $t('llm.setup.model_none') }}</option>
        <option v-for="m in options" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="model" :placeholder="$t('llm.setup.model_manual')" />
    </div>

    <div class="row">
      <span class="muted">{{ $t('llm.setup.add') }}</span>
      <select data-test="add" @change="onAdd">
        <option value="">—</option>
        <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.name }}</option>
        <option value="__custom__">{{ $t('llm.setup.custom') }}</option>
      </select>
    </div>
    <div v-if="!providers.length" class="muted">{{ $t('llm.setup.none') }}</div>

    <div v-for="(s, i) in providers" :key="i" class="prov">
      <div class="phead">
        <input v-if="s.custom" v-model="s.name" :placeholder="$t('llm.setup.name')" />
        <b v-else>{{ s.name }}</b>
        <span class="muted">{{ s.id }} · {{ s.baseURL }}</span>
        <button class="ghost rm" @click="removeProvider(i)">{{ $t('llm.setup.remove') }}</button>
      </div>
      <div v-if="s.custom" class="row">
        <input v-model="s.id" :placeholder="$t('llm.setup.provider_id')" />
        <input v-model="s.baseURL" :placeholder="$t('llm.setup.baseurl')" />
      </div>
      <div class="row">
        <input v-model="s.apiKey" :type="revealed.has(i) ? 'text' : 'password'" :placeholder="s.hasKey ? $t('llm.setup.key_set') : $t('llm.setup.key')" />
        <button class="ghost" @click="toggleReveal(i)">{{ revealed.has(i) ? $t('llm.setup.hide') : $t('llm.setup.reveal') }}</button>
      </div>
      <div v-if="isPreset(s.id)" class="models">
        <label v-for="m in presetModels(s.id)" :key="m.id" class="mchk">
          <input type="checkbox" :checked="s.models.includes(m.id)" @change="toggle(s, m.id)" />
          {{ m.id }}<span v-if="isVisionModel(s.id, m.id)" class="vtag">{{ $t('llm.setup.vision') }}</span>
        </label>
      </div>
      <div class="row">
        <input v-model="s.extraModels" :placeholder="isPreset(s.id) ? $t('llm.setup.manual') : $t('llm.setup.custom_models')" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button:disabled { opacity: .5; cursor: default; }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prov { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.phead { display: flex; gap: 8px; align-items: center; }
.phead input { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-size: 12px; }
.phead .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.phead .rm { margin-left: auto; }
.models { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); cursor: pointer; }
.vtag { color: var(--ac2); border: 1px solid var(--ac2); border-radius: 8px; padding: 0 5px; font-size: 10px; }
</style>
