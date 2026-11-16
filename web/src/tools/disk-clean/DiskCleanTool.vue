<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { t } from '../../i18n';
import { useProjects } from '../../useProjects';
import { useDiskClean } from './useDiskClean';
import { formatBytes } from './selection';
import type { DiskSettings } from './types';

const dc = useDiskClean();
const projects = useProjects();
const overview = ref<any>(null);
const showSettings = ref(false);
const showConfirm = ref(false);
const showResult = ref(false);
const draft = reactive<{ exclusionDirs: string[]; patternsText: string; customDirs: string[] }>({
  exclusionDirs: [], patternsText: '', customDirs: [],
});

const groups = computed(() => {
  const order: Array<{ key: string; labelKey: string }> = [
    { key: 'system', labelKey: 'diskclean.group.system' },
    { key: 'app', labelKey: 'diskclean.group.app' },
    { key: 'browser', labelKey: 'diskclean.group.browser' },
    { key: 'custom', labelKey: 'diskclean.group.custom' },
  ];
  const cats = dc.scan.value?.categories || [];
  return order.map((g) => ({ ...g, items: cats.filter((c) => c.group === g.key) })).filter((g) => g.items.length);
});

const totalCats = computed(() => dc.scan.value?.categories.length || 0);
const doneCats = computed(() => (dc.scan.value?.categories || []).filter((c) => c.status === 'done' || c.status === 'error').length);
const selectedCats = computed(() => (dc.scan.value?.categories || []).filter((c) => dc.selected.value.has(c.id)));
const riskyCats = computed(() => selectedCats.value.filter((c) => c.risk === 'risky'));
const errorText = computed(() => {
  const e = dc.error.value;
  if (!e) return '';
  if (e === 'scan_expired') return t('diskclean.expired');
  if (e === 'unsupported_platform') return t('diskclean.unsupported');
  if (e === 'need_confirm') return t('diskclean.need_select');
  return e;
});

onMounted(async () => {
  overview.value = await dc.loadBasics();
  if (!overview.value) dc.error.value = t('diskclean.unsupported');
  syncDraft(dc.settings.value);
});

function syncDraft(s: DiskSettings) {
  draft.exclusionDirs = [...(s.exclusions.dirs || [])];
  draft.patternsText = (s.exclusions.patterns || []).join('\n');
  draft.customDirs = [...(s.customDirs || [])];
}

function catName(c: { id: string }) {
  const key = `diskclean.cat.${c.id}`;
  const text = t(key);
  return text === key ? c.id : text;
}
function riskText(c: { risk: string }) { return t(`diskclean.risk.${c.risk}`); }

async function pick(into: string[]) {
  try {
    const r = await projects.pickFolder();
    if (r?.path) into.push(r.path);
  } catch { /* ignore */ }
}

function openSettings() {
  syncDraft(dc.settings.value);
  showSettings.value = true;
}

async function saveSettings() {
  try {
    const saved = await dc.saveSettings({
      exclusions: { dirs: draft.exclusionDirs, patterns: draft.patternsText.split('\n').map((s) => s.trim()).filter(Boolean) },
      customDirs: draft.customDirs,
    });
    syncDraft(saved);
    showSettings.value = false;
    dc.error.value = '';
    await dc.analyze();
  } catch (e: any) {
    dc.error.value = t('diskclean.settings_bad_dir', { error: String(e?.message || e) });
  }
}

function openConfirm() { if (dc.canClean.value) showConfirm.value = true; }

async function runClean() {
  showConfirm.value = false;
  await dc.clean();
  showResult.value = true;
  overview.value = await fetch('/api/disk-clean/overview').then((r) => r.json()).catch(() => overview.value);
}
</script>

<template>
  <div class="dc">
    <div class="head">
      <div>
        <div class="ttl">{{ $t('diskclean.title') }}</div>
        <div class="desc">{{ $t('diskclean.desc') }}</div>
      </div>
      <div class="ov" v-if="overview">
        {{ $t('diskclean.overview', { drive: overview.drive, free: formatBytes(overview.free), total: formatBytes(overview.total) }) }}
      </div>
    </div>

    <div class="bar">
      <button class="btn primary" :disabled="dc.busy.value" @click="dc.analyze()">
        {{ dc.phase.value === 'scanning' ? $t('diskclean.analyzing') : $t('diskclean.analyze') }}
      </button>
      <button class="btn" :disabled="!dc.canClean.value" @click="openConfirm">{{ $t('diskclean.clean') }}</button>
      <button class="btn" @click="openSettings">{{ $t('diskclean.settings') }}</button>
      <span v-if="dc.phase.value === 'scanning'" class="progress">{{ $t('diskclean.progress', { done: doneCats, total: totalCats }) }}</span>
    </div>

    <div v-if="errorText" class="err">{{ errorText }}</div>

    <div class="groups">
      <section v-for="g in groups" :key="g.key" class="group">
        <div class="ghead">{{ $t(g.labelKey) }}</div>
        <label v-for="c in g.items" :key="c.id" class="row" :class="c.risk">
          <input type="checkbox" :checked="dc.selected.value.has(c.id)" @change="dc.toggle(c.id)" />
          <span class="name">{{ catName(c) }}</span>
          <span class="badge" :class="c.risk">{{ riskText(c) }}</span>
          <span v-if="c.needsAdmin" class="badge admin">{{ $t('diskclean.admin_badge') }}</span>
          <span class="status" :class="c.status">{{ $t('diskclean.status.' + c.status) }}</span>
          <span v-if="c.truncated" class="badge warn">{{ $t('diskclean.truncated') }}</span>
          <span class="size">{{ c.status === 'done' ? formatBytes(c.bytes) : $t('diskclean.not_analyzed') }}</span>
          <span class="files">{{ c.status === 'done' ? c.files : '' }}</span>
        </label>
      </section>
    </div>

    <div class="foot">
      <span>{{ $t('diskclean.selected', { count: dc.totals.value.count }) }}</span>
      <span>{{ $t('diskclean.selected_size', { size: formatBytes(dc.totals.value.bytes) }) }}</span>
      <label class="perm"><input type="checkbox" v-model="dc.permanent.value" /> {{ $t('diskclean.permanent') }}</label>
      <button class="btn primary" :disabled="!dc.canClean.value" @click="openConfirm">{{ $t('diskclean.clean') }}</button>
    </div>

    <div v-if="showSettings" class="mask" @click.self="showSettings = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.settings') }}</div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_exclusions') }}</div>
          <div v-for="(d, i) in draft.exclusionDirs" :key="'e' + i" class="rowline">
            <input v-model="draft.exclusionDirs[i]" />
            <button class="btn" @click="draft.exclusionDirs.splice(i, 1)">×</button>
          </div>
          <button class="btn" @click="pick(draft.exclusionDirs)">＋ {{ $t('diskclean.settings_add_dir') }}</button>
        </div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_patterns') }}</div>
          <textarea v-model="draft.patternsText" rows="4" />
        </div>
        <div class="sect">
          <div class="label">{{ $t('diskclean.settings_custom') }}</div>
          <div v-for="(d, i) in draft.customDirs" :key="'c' + i" class="rowline">
            <input v-model="draft.customDirs[i]" />
            <button class="btn" @click="draft.customDirs.splice(i, 1)">×</button>
          </div>
          <button class="btn" @click="pick(draft.customDirs)">＋ {{ $t('diskclean.settings_add_dir') }}</button>
        </div>
        <div class="dlg-actions">
          <button class="btn" @click="showSettings = false">{{ $t('diskclean.close') }}</button>
          <button class="btn primary" @click="saveSettings">{{ $t('diskclean.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showConfirm" class="mask" @click.self="showConfirm = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.confirm_title') }}</div>
        <div class="body">
          {{ $t('diskclean.confirm_body', { count: dc.totals.value.count, size: formatBytes(dc.totals.value.bytes), mode: dc.permanent.value ? $t('diskclean.mode.permanent') : $t('diskclean.mode.recycle') }) }}
        </div>
        <div v-if="selectedCats.some((c) => c.needsAdmin)" class="warnbox">{{ $t('diskclean.admin_hint') }}</div>
        <div v-if="dc.permanent.value" class="warnbox">{{ $t('diskclean.permanent_warn') }}</div>
        <div v-if="riskyCats.length" class="sect">
          <div class="label">{{ $t('diskclean.confirm_risky') }}</div>
          <label v-for="c in riskyCats" :key="c.id" class="checkline">
            <input type="checkbox" :checked="dc.confirmed.value.has(c.id)" @change="dc.toggleConfirm(c.id)" />
            {{ $t('diskclean.confirm_risky_item', { name: catName(c) }) }}
          </label>
        </div>
        <div class="dlg-actions">
          <button class="btn" @click="showConfirm = false">{{ $t('diskclean.cancel') }}</button>
          <button class="btn primary" :disabled="dc.blockedRisky().length > 0" @click="runClean">{{ $t('diskclean.clean') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showResult" class="mask" @click.self="showResult = false">
      <div class="dlg">
        <div class="dlg-title">{{ $t('diskclean.result_title') }}</div>
        <div v-if="dc.result.value?.status === 'cancelled'" class="body">{{ $t('diskclean.cancelled') }}</div>
        <template v-else-if="dc.result.value">
          <div class="body">
            {{ $t('diskclean.result_summary', {
              size: formatBytes(dc.result.value.bytes || 0),
              removed: dc.result.value.removed || 0,
              skipped: dc.result.value.skipped || 0,
              failed: (dc.result.value.failed || []).length,
            }) }}
          </div>
          <div v-if="dc.result.value.mode === 'recycle'" class="hint">{{ $t('diskclean.result_recycle') }}</div>
          <div v-if="dc.result.value.error" class="err">{{ dc.result.value.error }}</div>
          <div v-if="(dc.result.value.failed || []).length" class="sect">
            <div class="label">{{ $t('diskclean.result_failed') }}</div>
            <div v-for="(f, i) in dc.result.value.failed" :key="i" class="failline">
              <span class="reason">{{ $t('diskclean.result_reason.' + (f.reason || 'other')) }}</span>
              <span class="path">{{ f.path }}</span>
            </div>
          </div>
        </template>
        <div class="dlg-actions">
          <button class="btn primary" @click="showResult = false">{{ $t('diskclean.close') }}</button>
        </div>
      </div>
    </div>

    <div class="hist" v-if="dc.history.value.length">
      <div class="label">{{ $t('diskclean.history') }}</div>
      <div v-for="(h, i) in dc.history.value.slice(-20).reverse()" :key="i" class="histline">
        {{ h.ts }} · {{ formatBytes(h.bytes || 0) }} · {{ h.removed || 0 }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc { height: 100%; overflow: auto; padding: 16px 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.head .ttl { font-size: 16px; font-weight: 700; color: var(--tx1); }
.head .desc { margin-top: 4px; font-size: 12px; color: var(--tx3); }
.ov { font-size: 12px; color: var(--tx2); }
.bar, .foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.foot { position: sticky; bottom: 0; background: var(--bg1); padding: 8px 0; border-top: 1px solid var(--bd2); }
.btn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.progress { font-size: 12px; color: var(--tx3); }
.err { color: var(--err); font-size: 12px; }
.groups { display: flex; flex-direction: column; gap: 10px; max-width: 1000px; }
.group { border: 1px solid var(--bd2); border-radius: 6px; overflow: hidden; }
.ghead { padding: 6px 10px; background: var(--bg2); font-size: 12px; font-weight: 700; color: var(--tx2); }
.row { display: grid; grid-template-columns: 18px 1fr auto auto auto auto 90px 60px; gap: 8px; align-items: center; padding: 6px 10px; border-top: 1px solid var(--bd2); font-size: 12px; cursor: pointer; }
.row .name { color: var(--tx1); }
.badge { font-size: 11px; border: 1px solid var(--bd); border-radius: 3px; padding: 1px 6px; color: var(--tx3); }
.badge.safe { color: var(--ok); border-color: var(--ok); }
.badge.caution { color: var(--warn2); }
.badge.risky { color: var(--err); border-color: var(--err); }
.badge.admin { color: var(--ac2); }
.badge.warn { color: var(--warn2); }
.status { color: var(--tx3); }
.size { text-align: right; color: var(--tx2); font-variant-numeric: tabular-nums; }
.files { text-align: right; color: var(--tx3); font-variant-numeric: tabular-nums; }
.perm { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--tx2); }
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dlg { width: min(720px, 92vw); max-height: 86vh; overflow: auto; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.dlg-title { font-size: 15px; font-weight: 700; color: var(--tx1); }
.body { font-size: 13px; color: var(--tx1); }
.hint { font-size: 12px; color: var(--tx3); }
.warnbox { font-size: 12px; color: var(--warn2); border: 1px solid var(--warn2); border-radius: 4px; padding: 6px 8px; }
.sect { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 12px; color: var(--tx2); font-weight: 600; }
.rowline { display: flex; gap: 6px; }
.rowline input, textarea { flex: 1; background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 12px; }
.checkline { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--tx1); }
.dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.failline { display: grid; grid-template-columns: 70px 1fr; gap: 8px; font-size: 12px; color: var(--tx3); }
.failline .path { font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.hist { display: flex; flex-direction: column; gap: 4px; max-width: 1000px; }
.histline { font-size: 12px; color: var(--tx3); }
</style>
