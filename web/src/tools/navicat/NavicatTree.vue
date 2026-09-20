<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '../../i18n';
import type { NavicatProfile } from './useNavicat';

const props = defineProps<{
  profiles: NavicatProfile[];
  activeId: string;
  activeDatabase: string;
  version: number;
  fetchDatabases: (id: string) => Promise<string[]>;
  fetchTables: (id: string, database: string) => Promise<string[]>;
}>();
const emit = defineEmits<{
  (e: 'select-conn', p: NavicatProfile): void;
  (e: 'select-database', db: string): void;
  (e: 'pick-table', database: string, table: string): void;
  (e: 'edit', p: NavicatProfile): void;
  (e: 'rename', p: NavicatProfile): void;
  (e: 'remove', p: NavicatProfile): void;
}>();

const expanded = ref<Record<string, boolean>>({});
const databases = ref<Record<string, string[]>>({});
const tables = ref<Record<string, string[]>>({});
const loading = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string>>({});

function setKey(store: { value: Record<string, any> }, key: string, value: any) {
  store.value = { ...store.value, [key]: value };
}
function clearKey(store: { value: Record<string, any> }, key: string) {
  const next = { ...store.value };
  delete next[key];
  store.value = next;
}

function dbKey(id: string) { return `d:${id}`; }
function tbKey(id: string, db: string) { return `t:${id}\u0000${db}`; }
function connExpanded(id: string) { return !!expanded.value[`c:${id}`]; }
function dbExpanded(id: string, db: string) { return !!expanded.value[`${id}\u0000${db}`]; }
function dbList(id: string) { return databases.value[id] || []; }
function tbList(id: string, db: string) { return tables.value[tbKey(id, db)] || []; }
function dbLoaded(id: string) { return databases.value[id] !== undefined; }
function tbLoaded(id: string, db: string) { return tables.value[tbKey(id, db)] !== undefined; }
function isLoading(key: string) { return !!loading.value[key]; }
function errorOf(key: string) { return errors.value[key] || ''; }

async function loadDatabases(p: NavicatProfile) {
  const id = p.id as string;
  const key = dbKey(id);
  if (databases.value[id] || loading.value[key]) return;
  setKey(loading, key, true);
  clearKey(errors, key);
  try {
    setKey(databases, id, await props.fetchDatabases(id));
  } catch (e) {
    setKey(errors, key, (e as Error).message || t('nv.schema_load_failed'));
  } finally {
    clearKey(loading, key);
  }
}

async function loadTables(id: string, db: string) {
  const key = tbKey(id, db);
  if (tables.value[key] || loading.value[key]) return;
  setKey(loading, key, true);
  clearKey(errors, key);
  try {
    setKey(tables, key, await props.fetchTables(id, db));
  } catch (e) {
    setKey(errors, key, (e as Error).message || t('nv.schema_load_failed'));
  } finally {
    clearKey(loading, key);
  }
}

async function toggleConn(p: NavicatProfile) {
  const id = p.id as string;
  const key = `c:${id}`;
  if (expanded.value[key]) { clearKey(expanded, key); return; }
  setKey(expanded, key, true);
  if (p.type === 'sqlite') await loadTables(id, p.database || '');
  else await loadDatabases(p);
}

async function toggleDb(p: NavicatProfile, db: string) {
  const id = p.id as string;
  const key = `${id}\u0000${db}`;
  if (expanded.value[key]) { clearKey(expanded, key); return; }
  setKey(expanded, key, true);
  await loadTables(id, db);
}

function retryDb(p: NavicatProfile) { clearKey(errors, dbKey(p.id as string)); void loadDatabases(p); }
function retryTables(id: string, db: string) { clearKey(errors, tbKey(id, db)); void loadTables(id, db); }

watch(() => props.version, () => {
  expanded.value = {};
  databases.value = {};
  tables.value = {};
  loading.value = {};
  errors.value = {};
});
</script>

<template>
  <div class="nvtree">
    <div v-for="p in profiles" :key="p.id" class="nvblock">
      <div class="nvconn" :class="{ on: p.id === activeId }">
        <span class="nvchev" :class="{ collapsed: !connExpanded(p.id as string) }" @click.stop="toggleConn(p)">▸</span>
        <span class="nvbtype">{{ p.type }}</span>
        <span class="nvconnname" @click="emit('select-conn', p)">{{ p.name }}</span>
        <span class="nvacts">
          <button class="nvedit" :title="$t('nv.edit')" @click.stop="emit('edit', p)">✎</button>
          <button class="nvrename" :title="$t('nv.rename')" @click.stop="emit('rename', p)">⇄</button>
          <button class="nvremove" :title="$t('nv.delete')" @click.stop="emit('remove', p)">×</button>
        </span>
      </div>

      <div v-if="connExpanded(p.id as string)" class="nvchildren">
        <template v-if="p.type === 'redis'">
          <div v-for="db in dbList(p.id as string)" :key="db" class="nvdbitem"
               :class="{ on: p.id === activeId && db === activeDatabase }">
            <span class="nvchev invisible">▸</span>
            <span class="nvdname" @click="emit('select-database', db)">{{ db }}</span>
          </div>
          <div v-if="isLoading(dbKey(p.id as string))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(dbKey(p.id as string))" class="nverr" @click="retryDb(p)">{{ errorOf(dbKey(p.id as string)) }}</div>
        </template>

        <template v-else-if="p.type === 'sqlite'">
          <div v-for="tb in tbList(p.id as string, p.database || '')" :key="tb" class="nvtb">
            <span class="nvchev invisible">▸</span>
            <span class="nvtbname" @click="emit('pick-table', '', tb)">{{ tb }}</span>
          </div>
          <div v-if="isLoading(tbKey(p.id as string, p.database || ''))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(tbKey(p.id as string, p.database || ''))" class="nverr" @click="retryTables(p.id as string, p.database || '')">{{ errorOf(tbKey(p.id as string, p.database || '')) }}</div>
          <div v-else-if="tbLoaded(p.id as string, p.database || '') && !tbList(p.id as string, p.database || '').length" class="nvempty">{{ $t('nv.tables') }}</div>
        </template>

        <template v-else>
          <div v-for="db in dbList(p.id as string)" :key="db" class="nvdbnode">
            <div class="nvdbitem" :class="{ on: p.id === activeId && db === activeDatabase }">
              <span class="nvchev" :class="{ collapsed: !dbExpanded(p.id as string, db) }" @click.stop="toggleDb(p, db)">▸</span>
              <span class="nvdname" @click="emit('select-database', db)">{{ db }}</span>
            </div>
            <div v-if="dbExpanded(p.id as string, db)" class="nvchildren">
              <div v-for="tb in tbList(p.id as string, db)" :key="tb" class="nvtb">
                <span class="nvchev invisible">▸</span>
                <span class="nvtbname" @click="emit('pick-table', db, tb)">{{ tb }}</span>
              </div>
              <div v-if="isLoading(tbKey(p.id as string, db))" class="nvloading">{{ $t('nv.loading') }}</div>
              <div v-else-if="errorOf(tbKey(p.id as string, db))" class="nverr" @click="retryTables(p.id as string, db)">{{ errorOf(tbKey(p.id as string, db)) }}</div>
              <div v-else-if="tbLoaded(p.id as string, db) && !tbList(p.id as string, db).length" class="nvempty">{{ $t('nv.tables') }}</div>
            </div>
          </div>
          <div v-if="isLoading(dbKey(p.id as string))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(dbKey(p.id as string))" class="nverr" @click="retryDb(p)">{{ errorOf(dbKey(p.id as string)) }}</div>
          <div v-else-if="dbLoaded(p.id as string) && !dbList(p.id as string).length" class="nvempty">{{ $t('nv.databases') }}</div>
        </template>
      </div>
    </div>

    <div v-if="!profiles.length" class="nvempty">{{ $t('nv.empty') }}</div>
  </div>
</template>

<style scoped>
.nvtree { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; font-size: 12px; }
.nvblock { display: flex; flex-direction: column; }
.nvconn, .nvdbitem { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 6px; cursor: pointer; color: var(--tx2); }
.nvconn:hover, .nvdbitem:hover { background: var(--bg4); }
.nvconn.on { background: var(--bg4); color: var(--ac2); }
.nvdbitem.on { background: var(--bg4); color: var(--ac2); }
.nvchildren { display: flex; flex-direction: column; gap: 2px; padding-left: 14px; }
.nvchildren .nvchildren { padding-left: 14px; }
.nvchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.nvchev.invisible { visibility: hidden; }
.nvchev.collapsed { transform: rotate(-90deg); }
.nvbtype { flex: none; font-size: 10px; color: var(--tx4); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; text-transform: uppercase; }
.nvconnname, .nvdname, .nvtbname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nvacts { display: none; flex: none; gap: 2px; }
.nvconn:hover .nvacts { display: inline-flex; }
.nvacts button { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.nvacts button:hover { color: var(--ac2); }
.nvdbnode { display: flex; flex-direction: column; }
.nvtb { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; color: var(--tx3); cursor: pointer; }
.nvtb:hover { background: var(--bg4); color: var(--ac2); }
.nvloading, .nvempty { padding: 4px 8px; color: var(--tx4); font-size: 11px; }
.nverr { padding: 4px 8px; color: #e06c75; font-size: 11px; cursor: pointer; }
</style>
