// Markdown → PPT 章节：默认只按一级标题切分（二级及以下留在同一页），代码块里的 # 不参与切分。
export function splitMarkdownSlides(md, maxLevel = 1) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const slides = [];
  let cur = [];
  let title = '';
  let fence = '';
  const flush = () => {
    const content = cur.join('\n').trim();
    if (content) slides.push({ title, content });
    cur = [];
    title = '';
  };
  for (const line of lines) {
    const fm = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const marker = fm[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = '';
      cur.push(line);
      continue;
    }
    if (!fence) {
      const hm = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hm && hm[1].length <= maxLevel) {
        flush();
        cur = [line];
        title = hm[2].trim();
        continue;
      }
    }
    cur.push(line);
  }
  flush();
  if (!slides.length) slides.push({ title: '', content: String(md || '') });
  return slides;
}
