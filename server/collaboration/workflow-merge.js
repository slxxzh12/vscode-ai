// 工作流列表融合：分发/安装时把远端工作流并进本地
// 规则（spec §9）：label 同名 → 用远端内容覆盖、保留本地 id；未命中 → 按 id upsert
export function mergeWorkflowList(current = [], incoming = []) {
  const out = [];
  const byLabel = new Map();
  const byId = new Map();
  for (const w of Array.isArray(current) ? current : []) {
    if (!w || !w.id) continue;
    out.push({ ...w });
    byId.set(String(w.id), out[out.length - 1]);
    const key = String(w.label || '').trim();
    if (key) byLabel.set(key, out[out.length - 1]);
  }
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (!raw || !raw.id || !Array.isArray(raw.stages)) continue;
    const key = String(raw.label || raw.id).trim();
    const hit = byLabel.get(key) || byId.get(String(raw.id));
    if (hit) {
      const keepId = hit.id;
      Object.assign(hit, { ...raw, id: keepId, label: key });   // 名字统一去首尾空格，保证同名判定稳定
      byId.set(String(keepId), hit);
      if (key) byLabel.set(key, hit);
      continue;
    }
    const added = { ...raw, label: key };
    out.push(added);
    byId.set(String(added.id), added);
    if (key) byLabel.set(key, added);
  }
  return out;
}

// 合并结果里把本地自定义的工作流排到最前；其余保持原有顺序（sort 稳定）。
export function preferLocalFirst(list = [], local = []) {
  const keyOf = (w) => String((w && (w.label || w.id)) || '').trim();
  const first = new Set((Array.isArray(local) ? local : []).map(keyOf));
  return (Array.isArray(list) ? list.slice() : []).sort(
    (a, b) => Number(first.has(keyOf(b))) - Number(first.has(keyOf(a))),
  );
}
