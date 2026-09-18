<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLlm } from '../useLlm';
import { type OpencodeConfigFile, type ProviderRow, rowsFromProvider, providerFromRows, collectModelOptions } from '../opencodeConfig';
import { t } from '../i18n';

const emit = defineEmits<{ (e: 'saved'): void }>();
const api = useLlm();
const file = ref<OpencodeConfigFile | null>(null);
const providers = ref<ProviderRow[]>([]);
const model = ref('');
const baseline = ref('');
const err = ref('');
const saved = ref(false);

const invalid = computed(() => !!file.value && file.value.exists && file.value.config === null);
const modelOptions = computed(() => collectModelOptions(providers.value));
const dirty = computed(() => JSON.stringify({ providers: providers.value, model: model.value }) !== baseline.value);

function applyFile(f: OpencodeConfigFile) {
  file.value = f;
  providers.value = f.config && f.config.provider ? rowsFromProvider(f.config.provider) : [];
  model.value = f.config && typeof f.config.model === 'string' ? f.config.model : '';
  baseline.value = JSON.stringify({ providers: providers.value, model: model.value });
}
async function load() {
  err.value = '';
  saved.value = false;
  try { applyFile(await api.opencodeConfig()); } catch (e: any) { err.value = e?.message || String(e); }
}
onMounted(load);

function addProvider() {
  const ids = new Set(providers.value.map((p) => p.id));
  let id = 'new-provider';
  let i = 2;
  while (ids.has(id)) { id = `new-provider-${i}`; i += 1; }
  providers.value.push({ id, name: '', baseURL: '', keys: [], extraOptions: '{}', models: [], rest: {} });
}
function removeProvider(index: number) {
  if (window.confirm(t('llm.oc.confirm_remove_provider'))) providers.value.splice(index, 1);
}
function addModel(p: ProviderRow) {
  const ids = new Set(p.models.map((m) => m.id));
  let id = 'new-model';
  let i = 2;
  while (ids.has(id)) { id = `new-model-${i}`; i += 1; }
  p.models.push({ id, name: '', extra: '{}' });
}
function removeModel(p: ProviderRow, index: number) {
  if (window.confirm(t('llm.oc.confirm_remove_model'))) p.models.splice(index, 1);
}
async function save() {
  err.value = '';
  const built = providerFromRows(providers.value);
  if (!built.ok) {
    err.value = built.error === 'need-id' || built.error === 'dup-id' ? t('llm.oc.need_id') : t('llm.oc.bad_json');
    return;
  }
  try {
    await api.saveOpencodeConfig({ provider: built.value, model: model.value.trim() });
    await load();
    saved.value = true;
    emit('saved');
  } catch (e: any) { err.value = e?.message || String(e); }
}
</script>

<template>
  <section class="card">
    <div class="ch">{{ $t('llm.oc.title') }}
      <span class="row">
        <button class="ghost" @click="load">{{ $t('llm.oc.reload') }}</button>
        <button :disabled="!dirty || invalid" @click="save">{{ saved ? $t('llm.oc.saved') : $t('llm.oc.save') }}</button>
      </span>
    </div>
    <div class="muted">{{ $t('llm.oc.file', { path: file?.path || '' }) }}</div>
    <div v-if="invalid" class="warn">{{ $t('llm.oc.invalid') }}</div>
    <div v-else-if="file && !file.exists" class="muted">{{ $t('llm.oc.missing') }}</div>
    <div v-if="file?.format === 'jsonc'" class="muted">{{ $t('llm.oc.jsonc_hint') }}</div>
    <div v-if="err" class="err">{{ err }}</div>

    <div class="row">
      <span class="muted">{{ $t('llm.oc.default_model') }}</span>
      <select v-model="model">
        <option value="">{{ $t('llm.oc.model_none') }}</option>
        <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="model" :placeholder="$t('llm.oc.model_manual')" />
    </div>

    <div class="ch">{{ $t('llm.oc.providers') }}
      <button class="ghost" @click="addProvider">{{ $t('llm.oc.add_provider') }}</button>
    </div>

    <div v-for="(p, pi) in providers" :key="pi" class="prov">
      <div class="row">
        <input v-model="p.id" :placeholder="$t('llm.oc.provider_id')" />
        <input v-model="p.name" :placeholder="$t('llm.oc.name')" />
        <button class="danger" @click="removeProvider(pi)">{{ $t('llm.oc.remove') }}</button>
      </div>
      <div class="row">
        <input v-model="p.baseURL" :placeholder="$t('llm.oc.baseurl')" />
      </div>
      <div class="muted">{{ $t('llm.oc.keys_hint') }}</div>
      <div v-for="(k, ki) in p.keys" :key="ki" class="row">
        <input v-model="p.keys[ki]" :placeholder="$t('llm.oc.key')" />
        <button class="ghost" @click="p.keys.splice(ki, 1)">×</button>
      </div>
      <button class="ghost" @click="p.keys.push('')">{{ $t('llm.oc.add_key') }}</button>
      <details class="ex">
        <summary>{{ $t('llm.oc.advanced_options') }}</summary>
        <textarea v-model="p.extraOptions" class="cfg" rows="4"></textarea>
      </details>

      <div class="ch">{{ $t('llm.oc.models') }}
        <button class="ghost" @click="addModel(p)">{{ $t('llm.oc.add_model') }}</button>
      </div>
      <div v-for="(m, mi) in p.models" :key="mi" class="model">
        <div class="row">
          <input v-model="m.id" :placeholder="$t('llm.oc.model_id')" />
          <input v-model="m.name" :placeholder="$t('llm.oc.name')" />
          <button class="danger" @click="removeModel(p, mi)">{{ $t('llm.oc.remove') }}</button>
        </div>
        <details class="ex">
          <summary>{{ $t('llm.oc.advanced') }}</summary>
          <textarea v-model="m.extra" class="cfg" rows="4"></textarea>
        </details>
      </div>
    </div>

    <details class="ex">
      <summary>{{ $t('llm.oc.raw') }}</summary>
      <pre class="cfg">{{ file?.raw }}</pre>
    </details>
  </section>
</template>

<style scoped>
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button.danger { background: none; border-color: var(--err); color: var(--err); }
button:disabled { opacity: .5; cursor: default; }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prov { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.model { border-top: 1px solid var(--bd); padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 240px; white-space: pre-wrap; width: 100%; box-sizing: border-box; font-family: inherit; }
.ex summary { cursor: pointer; color: var(--tx2); font-size: 12px; }
.ex .cfg { margin-top: 6px; }
</style>
