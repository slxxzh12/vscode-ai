import { createJsonStore } from './json-store.js';

export const MAX_GROUPS = 50;
export const MAX_GROUP_NAME_LEN = 40;

export function emptyGroups() { return { groups: [], members: {} }; }

// 归一化：组名去空/去重/截断/限量；成员只保留「有名字且在组内」的项
export function normalizeGroups(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const groups = [];
  for (const raw of Array.isArray(src.groups) ? src.groups : []) {
    const g = String(raw ?? '').trim().slice(0, MAX_GROUP_NAME_LEN);
    if (!g || groups.includes(g)) continue;
    groups.push(g);
    if (groups.length >= MAX_GROUPS) break;
  }
  const members = {};
  const srcMembers = src.members && typeof src.members === 'object' && !Array.isArray(src.members) ? src.members : {};
  for (const [k, v] of Object.entries(srcMembers)) {
    const key = String(k ?? '').trim();
    const g = String(v ?? '').trim();
    if (!key || !g || !groups.includes(g)) continue;
    members[key] = g;
  }
  return { groups, members };
}

export function createCodeGroups({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeGroups, defaults: emptyGroups });
}
