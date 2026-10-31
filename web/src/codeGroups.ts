import { ref } from 'vue';

export interface CodeGroups { groups: string[]; members: Record<string, string>; }

const groups = ref<string[]>([]);
const members = ref<Record<string, string>>({});
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchGroups(): Promise<CodeGroups> {
  const res = await fetch('/api/code/groups');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CodeGroups>;
}

async function putGroups(data: CodeGroups): Promise<CodeGroups> {
  const res = await fetch('/api/code/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CodeGroups>;
}

// 纯函数：把 [{key,value}] 按成员归属汇总成饼图数据；未归属 name=''（排最后）
export function groupSlices(items: { key: string; value: number }[], map: Record<string, string>): { name: string; value: number }[] {
  const acc = new Map<string, number>();
  for (const it of items) {
    const name = map[it.key] || '';
    acc.set(name, (acc.get(name) || 0) + it.value);
  }
  return [...acc.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => ((a.name === '') === (b.name === '') ? b.value - a.value : (a.name === '' ? 1 : -1)));
}

export function useCodeGroups() {
  async function load(force = false) {
    if (loaded && !force) return;
    try {
      const d = await fetchGroups();
      groups.value = Array.isArray(d.groups) ? d.groups : [];
      members.value = d.members && typeof d.members === 'object' ? d.members : {};
      loaded = true;
    } catch { /* 保留现状 */ }
  }

  async function save() {
    const d = await putGroups({ groups: groups.value, members: members.value });
    groups.value = Array.isArray(d.groups) ? d.groups : [];
    members.value = d.members && typeof d.members === 'object' ? d.members : {};
    loaded = true;
    return d;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save().catch(() => { /* ignore */ }); }, 400);
  }

  function addGroup(name: string) {
    const g = name.trim().slice(0, 40);
    if (!g || groups.value.includes(g)) return false;
    groups.value = [...groups.value, g];
    scheduleSave();
    return true;
  }

  function removeGroup(name: string) {
    groups.value = groups.value.filter((g) => g !== name);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(members.value)) if (v !== name) next[k] = v;
    members.value = next;
    scheduleSave();
  }

  function assign(author: string, group: string) {
    if (!author) return;
    const next = { ...members.value };
    if (group) next[author] = group; else delete next[author];
    members.value = next;
    scheduleSave();
  }

  return {
    groups,
    members,
    load,
    save,
    addGroup,
    removeGroup,
    assign,
    groupOf: (author: string) => members.value[author] || '',
  };
}
