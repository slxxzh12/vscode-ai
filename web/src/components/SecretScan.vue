<script setup lang="ts">
import { ref, computed } from 'vue';
import { fetchSecretScan, groupFindingsByFile, type SecretScanResult, type SecretFinding, type SecretSeverity } from '../secretScan';
import { parseDirs } from '@devflow/shared/git-filter';
import { toCsv, zipStamp, downloadZip } from '../csv';
import { t } from '../i18n';

const props = defineProps<{ dirs: string[]; excludeDirsText: string }>();
const emit = defineEmits<{ (e: 'ran', dir: string): void }>();

interface DirEntry { dir: string; result: SecretScanResult | null; error: string; }

const loading = ref(false);
const error = ref('');
const entries = ref<DirEntry[]>([]);
const collapsed = ref<Set<string>>(new Set());

function toggleEntry(dir: string) {
  const s = new Set(collapsed.value);
  if (s.has(dir)) s.delete(dir); else s.add(dir);
  collapsed.value = s;
}

async function run() {
  const list = [...new Set(props.dirs.map((d) => d.trim()).filter(Boolean))];
  if (!list.length) { error.value = t('codestat.need_dir'); return; }
  loading.value = true;
  error.value = '';
  entries.value = [];
  collapsed.value = new Set();
  const excludeDirs = parseDirs(props.excludeDirsText);
  try {
    const settled = await Promise.all(list.map(async (dir): Promise<DirEntry> => {
      try {
        const result = await fetchSecretScan({ dir, excludeDirs });
        return { dir, result, error: '' };
      } catch (e: any) {
        return { dir, result: null, error: String(e?.message || e) };
      }
    }));
    entries.value = settled;
    for (const e of settled) if (e.result) emit('ran', e.dir);
  } finally {
    loading.value = false;
  }
}

const okResults = computed<SecretScanResult[]>(() => entries.value.map((e) => e.result).filter((r): r is SecretScanResult => !!r));
const total = computed(() => okResults.value.reduce(
  (s, r) => ({
    scanned: s.scanned + r.scanned,
    files: s.files + r.totals.files,
    findings: s.findings + r.totals.findings,
  }),
  { scanned: 0, files: 0, findings: 0 },
));
const failedCount = computed(() => entries.value.filter((e) => e.error).length);
const highCount = computed(() => okResults.value.reduce((s, r) => s + r.findings.filter((f) => f.severity === 'high').length, 0));

function ruleLabel(id: string): string {
  return t(`codestat.scan.rule.${id}`);
}
function severityLabel(s: SecretSeverity): string {
  return t(`codestat.scan.severity.${s}`);
}

const exporting = ref(false);
async function exportCsv() {
  if (!okResults.value.length) return;
  exporting.value = true;
  try {
    const rows = entries.value.flatMap((e) => (e.result
      ? e.result.findings.map((f) => [e.dir, f.rel, f.line, ruleLabel(f.rule), severityLabel(f.severity), f.match])
      : []));
    const content = toCsv([
      t('codestat.col.repo'), t('codestat.scan.col.file'), t('codestat.scan.col.line'),
      t('codestat.scan.col.rule'), t('codestat.scan.col.severity'), t('codestat.scan.col.match'),
    ], rows);
    await downloadZip(`codestat-secret-scan-${zipStamp()}.zip`, [{ name: 'secret-scan.csv', content }]);
  } catch (e: any) {
    alert(t('codestat.export_failed', { msg: e?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="ss">
    <div class="toolbar">
      <button class="go" :disabled="loading" @click="run">{{ loading ? $t('codestat.scan.running') : $t('codestat.scan.run') }}</button>
      <button class="ghost" :disabled="exporting || !okResults.length" @click="exportCsv">{{ $t('codestat.export') }}</button>
      <span class="hint">{{ $t('codestat.scan.hint') }}</span>
    </div>
    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="entries.length" class="res">
      <section class="total">
        <div class="cards">
          <div class="card"><b>{{ total.scanned }}</b><span>{{ $t('codestat.scan.scanned') }}</span></div>
          <div class="card" :class="{ bad: total.findings > 0 }"><b>{{ total.findings }}</b><span>{{ $t('codestat.scan.findings') }}</span></div>
          <div class="card" :class="{ bad: total.findings > 0 }"><b>{{ total.files }}</b><span>{{ $t('codestat.scan.affected_files') }}</span></div>
          <div class="card" :class="{ bad: highCount > 0 }"><b>{{ highCount }}</b><span>{{ $t('codestat.scan.severity.high') }}</span></div>
        </div>
        <div v-if="failedCount" class="warn">{{ $t('codestat.some_failed', { count: failedCount }) }}</div>
        <div v-if="total.findings === 0" class="clean">{{ $t('codestat.scan.clean') }}</div>
      </section>

      <section v-for="(e, i) in entries" :key="e.dir" class="entry">
        <button class="ehead" @click="toggleEntry(e.dir)">
          <span class="ecaret">{{ collapsed.has(e.dir) ? '▸' : '▾' }}</span>
          <span class="eidx">#{{ i + 1 }}</span>
          <span class="edir">{{ e.dir }}</span>
          <span v-if="e.result" class="ecount">{{ $t('codestat.scan.files_count', { count: e.result.totals.files }) }}</span>
        </button>
        <template v-if="!collapsed.has(e.dir)">
          <div v-if="e.error" class="err">{{ e.error }}</div>
          <template v-else-if="e.result">
            <div v-if="e.result.truncated" class="warn">{{ $t('codestat.scan.truncated') }}</div>

            <template v-if="e.result.byRule.length">
              <h3 class="sub">{{ $t('codestat.scan.by_rule') }}</h3>
              <table class="tbl">
                <thead><tr>
                  <th>{{ $t('codestat.scan.col.rule') }}</th>
                  <th>{{ $t('codestat.scan.col.severity') }}</th>
                  <th class="num">{{ $t('codestat.scan.findings') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="r in e.result.byRule" :key="r.rule">
                    <td>{{ ruleLabel(r.rule) }}</td>
                    <td><span class="sev" :class="r.severity">{{ severityLabel(r.severity) }}</span></td>
                    <td class="num bad">{{ r.count }}</td>
                  </tr>
                </tbody>
              </table>

              <h3 class="sub">{{ $t('codestat.scan.details') }}</h3>
              <div v-for="g in groupFindingsByFile(e.result.findings)" :key="g.rel" class="filegroup">
                <div class="fghead">{{ g.rel }}</div>
                <table class="tbl">
                  <thead><tr>
                    <th class="num">{{ $t('codestat.scan.col.line') }}</th>
                    <th>{{ $t('codestat.scan.col.rule') }}</th>
                    <th>{{ $t('codestat.scan.col.severity') }}</th>
                    <th>{{ $t('codestat.scan.col.match') }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="(f, fi) in g.findings" :key="fi">
                      <td class="num">{{ f.line }}</td>
                      <td>{{ ruleLabel(f.rule) }}</td>
                      <td><span class="sev" :class="f.severity">{{ severityLabel(f.severity) }}</span></td>
                      <td class="match">{{ f.match }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <div v-else class="empty">{{ $t('codestat.scan.clean') }}</div>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ss { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.toolbar { flex: none; padding: 0 0 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 9px 40px; font-size: 14px; font-weight: 600; cursor: pointer; }
.go:disabled { opacity: .6; cursor: default; }
.ghost { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 9px 18px; font-size: 13px; cursor: pointer; }
.ghost:hover { color: var(--tx1); border-color: var(--ac); }
.ghost:disabled { opacity: .5; cursor: default; }
.hint { color: var(--tx4); font-size: 12px; }
.err { flex: none; margin: 0 0 8px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--err) 15%, transparent); color: var(--err); font-size: 12px; }
.res { flex: 1; min-height: 0; overflow: auto; padding: 0 0 24px; }
.total { padding: 8px 0 12px; border-bottom: 1px solid var(--bd2); }
.cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
.card { display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.card b { font-size: 18px; color: var(--tx1); }
.card span { font-size: 11px; color: var(--tx3); }
.card.bad b { color: var(--err); }
.clean { margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--ok, #3fb950) 15%, transparent); color: var(--ok, #3fb950); font-size: 12px; }
.entry { padding: 10px 0 16px; border-bottom: 1px solid var(--bd2); }
.entry:last-child { border-bottom: none; }
.ehead { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 6px; padding: 4px 4px; background: none; border: none; border-radius: 4px; text-align: left; cursor: pointer; color: var(--tx); }
.ehead:hover { background: var(--bg3); }
.ecaret { flex: none; width: 12px; color: var(--tx4); }
.eidx { flex: none; color: var(--tx4); font-size: 11px; }
.edir { color: var(--tx1); font-weight: 600; font-size: 12px; font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.ecount { flex: none; margin-left: auto; color: var(--tx4); font-size: 11px; }
.sub { color: var(--tx1); font-size: 13px; margin: 8px 0 6px; }
.filegroup { margin-bottom: 10px; }
.fghead { color: var(--tx2); font-size: 12px; font-family: ui-monospace, Consolas, monospace; word-break: break-all; padding: 4px 0; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
.tbl th { text-align: left; color: var(--tx4); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--bd2); }
.tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); vertical-align: top; }
.tbl .num { text-align: right; color: var(--tx4); white-space: nowrap; }
.tbl .num.bad { color: var(--err); }
.sev { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 11px; line-height: 18px; }
.sev.high { background: color-mix(in srgb, var(--err) 18%, transparent); color: var(--err); }
.sev.medium { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
.match { font-family: ui-monospace, Consolas, monospace; color: var(--tx3); word-break: break-all; }
.empty { color: var(--tx4); font-size: 12px; padding: 12px 0; }
.warn { margin: 4px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); font-size: 12px; }
</style>
