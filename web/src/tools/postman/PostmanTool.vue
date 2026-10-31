<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanWorkbench } from './usePostmanWorkbench';
import CodeEditor from '../../components/CodeEditor.vue';

const {
  activeFolder, respHeaders, respBody, respStderr, status, failed, busy, msg,
  curlCmd, load, normalizeCurlCmd, runCurlCmd, batchRun, clear,
} = usePostmanWorkbench();

const hasOutput = computed(() => !!(respHeaders.value || respBody.value || respStderr.value));
const respState = computed(() => {
  if (status.value >= 400) return 'err';
  if (status.value >= 200 && status.value < 300) return 'ok';
  if (status.value > 0) return 'neutral';
  return failed.value ? 'warn' : 'neutral';
});
const saveTo = computed(() => (activeFolder.value ? `/${activeFolder.value}` : '/'));

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 2000);
}
async function copyOut() {
  if (!hasOutput.value) return;
  await copyText([respHeaders.value, respBody.value, respStderr.value].filter(Boolean).join('\n'));
}

type EnlargeKey = 'headers' | 'body' | 'stderr';
const enlarged = ref<{ title: string; value: string; placeholder: string } | null>(null);
const enlargeMeta: Record<EnlargeKey, { titleKey: string; phKey: string; read: () => string }> = {
  headers: { titleKey: 'tools.pm_headers', phKey: 'tools.pm_noheaders', read: () => respHeaders.value },
  body: { titleKey: 'tools.pm_body', phKey: 'tools.output', read: () => respBody.value },
  stderr: { titleKey: 'tools.pm_stderr', phKey: 'tools.pm_nostderr', read: () => respStderr.value },
};
function openEnlarge(key: EnlargeKey) { const m = enlargeMeta[key]; enlarged.value = { title: t(m.titleKey), value: m.read(), placeholder: t(m.phKey) }; }
function closeEnlarge() { enlarged.value = null; }
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape' && enlarged.value) closeEnlarge(); }

onMounted(() => { void load(); window.addEventListener('keydown', onKeydown); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="pmbody">
    <section class="pmmain">
      <div class="pmactsbar">
        <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
        <button class="pmbtn" @click="clear">{{ $t('tools.clear') }}</button>
        <button class="pmbtn pmrunall" :disabled="busy" :title="$t('tools.pm_run_all_tip')" @click="batchRun">{{ $t('tools.pm_run_all') }}</button>
        <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
      </div>

      <div class="pmmsgrow"><div v-if="msg" class="pmmsg">{{ msg }}</div></div>

      <div class="pmcurlbox">
        <div class="pmcurlbar"><span class="pmcurlprompt">curl</span><span class="pmcurltip">{{ $t('tools.pm_tip') }}</span></div>
        <CodeEditor v-model="curlCmd" class="pmcurl" language="cmd.sh" :placeholder="$t('tools.pm_ph')" @blur="normalizeCurlCmd" />
      </div>

      <label class="pmlabel">{{ $t('tools.pm_resp') }}</label>
      <div class="pmresp" :class="respState">
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_headers') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respHeaders" @click="openEnlarge('headers')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respHeaders" class="pmfield pmheaders" readonly :placeholder="$t('tools.pm_noheaders')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_body') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respBody" @click="openEnlarge('body')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respBody" class="pmfield pmout" readonly :placeholder="$t('tools.output')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_stderr') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respStderr" @click="openEnlarge('stderr')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respStderr" class="pmfield pmstderr" readonly :placeholder="$t('tools.pm_nostderr')" />
        </div>
        <div class="pmoutacts">
          <button class="pmmini" :disabled="!hasOutput" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="enlarged" class="pmoverlay" @click.self="closeEnlarge">
        <div class="pmmodal" role="dialog" aria-modal="true">
          <header class="pmmodalhead">
            <span class="pmmodaltitle">{{ enlarged?.title }}</span>
            <div class="pmmodalacts">
              <button class="pmmini" @click="copyText(enlarged?.value ?? '')">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
              <button class="pmmini pmclose" @click="closeEnlarge">{{ $t('tools.pm_close') }}</button>
            </div>
          </header>
          <CodeEditor :model-value="enlarged?.value ?? ''" class="pmmodaledit" readonly :placeholder="enlarged?.placeholder ?? ''" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pmbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.pmmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.pmactsbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pmbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.pmbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.pmbtn:disabled { opacity: .55; cursor: default; }
.pmsave { color: var(--tx4); font-size: 12px; }
/* 提示信息固定占一行，避免出现/消失时内容上下跳动 */
.pmmsgrow { min-height: 16px; }
.pmmsg { color: var(--tx3); font-size: 12px; line-height: 16px; }
.pmlabel { color: var(--tx3); font-size: 12px; }
.pmcurlbox { display: flex; flex-direction: column; border: 1px solid var(--ac2); border-radius: 8px; overflow: hidden; background: var(--bg1); }
.pmcurlbar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg4); border-bottom: 1px solid var(--bd); }
.pmcurlprompt { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 700; color: var(--ac2); }
.pmcurltip { color: var(--tx4); font-size: 11px; }
.pmcurl { flex: none; --cm-min: 120px; --cm-border: none; --cm-radius: 0; background: transparent; }
/* 响应区：三个框固定高度，超出时整区滚动，避免互相挤压 */
.pmresp { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; }
.pmfieldbox { flex: none; display: flex; flex-direction: column; gap: 4px; }
.pmfieldhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pmfieldlabel { color: var(--tx4); font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.pmfield { --cm-min: 96px; }
.pmheaders { height: 120px; }
.pmout { height: 260px; }
.pmstderr { height: 160px; }
.pmenlarge { padding: 2px 10px; font-size: 12px; }
.pmresp.ok .pmfield { border-color: #2e7d32; }
.pmresp.err .pmfield { border-color: #c62828; }
.pmresp.warn .pmfield { border-color: #f9a825; }
.pmoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.pmmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.pmmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmmini:disabled { opacity: .5; cursor: default; }
/* 放大浮层：固定尺寸居中，不拖拽/缩放 */
.pmoverlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 80; }
.pmmodal { width: min(1100px, 92vw); height: 86vh; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, .5); display: flex; flex-direction: column; overflow: hidden; }
.pmmodalhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.pmmodaltitle { color: var(--tx2); font-size: 13px; font-family: ui-monospace, Consolas, monospace; }
.pmmodalacts { display: flex; gap: 8px; }
.pmmodaledit { flex: 1; min-height: 0; --cm-min: 0; --cm-border: none; --cm-radius: 0; }
</style>
