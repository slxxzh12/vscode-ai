// 浏览器端 Markdown 增强（Mermaid）：Web 预览与静态网站 Markdown 页面共用同一份实现。

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ```mermaid row 标记的连续图块自动并排（外层 flex 容器）
export function groupMermaidSides(container) {
  for (const pre of Array.from(container.querySelectorAll('pre.mermaid.mermaid-side'))) {
    if (pre.closest('.mermaid-row')) continue;
    const group = [pre];
    let next = pre.nextElementSibling;
    while (next && next.matches('pre.mermaid.mermaid-side')) {
      group.push(next);
      next = next.nextElementSibling;
    }
    if (group.length < 2) continue;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-row';
    pre.before(wrap);
    for (const item of group) wrap.appendChild(item);
  }
}

export async function renderMermaidBlocks(container, mermaid, options = {}) {
  groupMermaidSides(container);
  const nodes = Array.from(container.querySelectorAll('pre.mermaid:not([data-processed="true"])'));
  if (!nodes.length) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: options.theme || 'dark',
  });
  let seq = 0;
  await Promise.all(nodes.map(async (pre) => {
    const code = pre.textContent || '';
    const id = `df-mm-${Date.now().toString(36)}-${seq++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      const holder = document.getElementById(id);
      if (holder) holder.remove();
      pre.outerHTML = svg;
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      const text = options.errorText ? options.errorText(msg) : msg;
      pre.innerHTML = `<div class="mermaid-err">${escapeHtml(text)}</div>`;
    }
  }));
}
