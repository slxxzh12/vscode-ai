// 会话详细描述：仅提示展示，按会话持久化。trim 后非空写入，空/纯空白即删除。
export function setTabDescription(
  map: Record<string, string>,
  sid: string,
  description: string,
): Record<string, string> {
  const next = { ...map };
  const v = description.trim();
  if (v) next[sid] = v;
  else delete next[sid];
  return next;
}
