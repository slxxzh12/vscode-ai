export function hashPartition(topic, taskId, count) {
  const s = `${topic}:${taskId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, Number(count) || 1);
}

export function assignPartitions(workerIds, count) {
  const out = new Map(workerIds.map((id) => [id, []]));
  if (!workerIds.length) return out;
  for (let p = 0; p < count; p += 1) out.get(workerIds[p % workerIds.length]).push(p);
  return out;
}
