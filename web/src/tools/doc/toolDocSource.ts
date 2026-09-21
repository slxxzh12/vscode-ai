import type { DocSource } from './docSource';
import type { FileTool } from '../files/useToolFiles';

// 工具文件的文档来源：读写走 /api/files/<tool>/*。
// 不提供 rawUrl/meta/hash/reveal/run/markdownImageBase → DocViewer 自动隐藏对应能力（工具文件按纯文本处理）。
export function toolDocSource(tool: FileTool): DocSource {
  const base = `/api/files/${tool}`;
  async function jfetch(url: string, opt: RequestInit = {}) {
    const res = await fetch(url, opt);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
    return j;
  }
  return {
    kind: 'tool',
    async read(id) {
      const j = await jfetch(`${base}/file?id=${encodeURIComponent(id)}`);
      const leaf = id.slice(id.lastIndexOf('/') + 1);
      return { name: leaf, content: typeof j.content === 'string' ? j.content : '', size: Number(j.size) || 0 };
    },
    async write(id, content) {
      await jfetch(`${base}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content }),
      });
    },
  };
}
