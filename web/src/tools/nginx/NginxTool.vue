<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { useNginx, emptyRule, deepseekFlashRule, type NginxRule } from './useNginx';
import NginxRuleCard from './NginxRuleCard.vue';
import { nginxErrText } from './errors';

const api = useNginx();
const draft = ref<{ key: string; rule: NginxRule } | null>(null);
const highlightId = ref('');
const msg = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  const wanted = new URLSearchParams(location.search).get('rule') || '';
  await api.load();
  if (wanted && api.rules.value.some((r) => r.id === wanted)) highlightId.value = wanted;
  timer = setInterval(() => { void api.load(); }, 2000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

function blankNew() {
  msg.value = '';
  draft.value = { key: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`, rule: emptyRule() };
}
function onDraftSaved(rule: NginxRule) {
  draft.value = null;
  highlightId.value = rule.id || '';
}
function clearDraft() { draft.value = null; }

async function deepseekNew() {
  try { await ElMessageBox.confirm(t('nginx.sample_confirm'), t('nginx.sample_deepseek'), { type: 'warning' }); } catch { return; }
  msg.value = '';
  await api.load();
  const ex = api.rules.value.find((r) => r.name === 'deepseek-flash');
  if (ex) { highlightId.value = ex.id || ''; return; }
  try {
    const saved = await api.save(deepseekFlashRule());
    highlightId.value = saved.id || '';
  } catch (e) { msg.value = nginxErrText(e); }
}
</script>

<template>
  <div class="ngbody">
    <div class="ngnewrow">
      <button class="ngbtn ngnew" @click="blankNew">{{ $t('nginx.new') }}</button>
      <button class="ngbtn" @click="deepseekNew">{{ $t('nginx.sample_deepseek') }}</button>
      <span v-if="msg" class="ngmsg">{{ msg }}</span>
    </div>

    <NginxRuleCard
      v-if="draft"
      :key="draft.key"
      :rule="draft.rule"
      :api="api"
      draft
      @saved="onDraftSaved"
      @deleted="clearDraft"
    />

    <NginxRuleCard
      v-for="r in api.rules.value"
      :key="r.id"
      :rule="r"
      :api="api"
      :status="r.id ? api.status.value[r.id] : null"
      :highlight="highlightId === r.id"
    />

    <div v-if="!api.rules.value.length && !draft" class="ngempty">{{ $t('nginx.empty') }}</div>
  </div>
</template>

<style scoped>
.ngbody { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; overflow: auto; padding: 4px 2px; box-sizing: border-box; }
.ngnewrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex: none; }
.ngempty { padding: 12px; opacity: .6; }
.ngbtn { background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ngmsg { color: var(--ac2); }
</style>
