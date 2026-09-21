// 工作流配置 XML 的纯解析/序列化（无依赖、无 i18n）。
// server 与 web 共用，避免两份实现漂移。

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : '';
}

export function parseWorkflowsXml(xml) {
  const workflows = [];
  if (typeof xml !== 'string') return workflows;
  const wfRe = /<workflow\b([^>]*)>([\s\S]*?)<\/workflow>/g;
  let wm;
  while ((wm = wfRe.exec(xml))) {
    const wf = {
      id: attr(wm[1], 'id') || `wf-${workflows.length}`,
      label: attr(wm[1], 'label') || attr(wm[1], 'id'),
      stages: [],
    };
    const prioRaw = attr(wm[1], 'priority');
    if (prioRaw !== '') {
      const n = Number(prioRaw);
      wf.priority = Number.isFinite(n) ? n : 0;
    }
    const stRe = /<stage\b([^>]*)>([\s\S]*?)<\/stage>/g;
    let sm;
    while ((sm = stRe.exec(wm[2]))) {
      const st = {
        id: attr(sm[1], 'id') || `st-${wf.stages.length}`,
        label: attr(sm[1], 'label') || attr(sm[1], 'id'),
        group: attr(sm[1], 'group') || '',
        prompts: [],
      };
      const prRe = /<prompt>([\s\S]*?)<\/prompt>/g;
      let pm;
      while ((pm = prRe.exec(sm[2]))) { const text = decode(pm[1]); if (text) st.prompts.push(text); }
      wf.stages.push(st);
    }
    if (wf.stages.length) workflows.push(wf);
  }
  return workflows;
}

export function serializeWorkflow(w) {
  const prio = Number.isFinite(Number(w.priority)) ? Number(w.priority) : 0;
  const pAttr = prio ? ` priority="${prio}"` : '';
  const stages = (w.stages || []).map((s) => {
    const group = s.group ? ` group="${escXml(s.group)}"` : '';
    const prompts = (s.prompts || []).map((p) => `      <prompt>${escXml(p)}</prompt>`).join('\n');
    return `    <stage id="${escXml(s.id)}" label="${escXml(s.label)}"${group}>\n${prompts}\n    </stage>`;
  }).join('\n');
  return `  <workflow id="${escXml(w.id)}" label="${escXml(w.label)}"${pAttr}>\n${stages}\n  </workflow>`;
}

// 按 priority 降序 → label 升序 → id 升序；缺失 priority 视为 0。
export function sortWorkflows(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const prio = (w) => (Number.isFinite(Number(w && w.priority)) ? Number(w.priority) : 0);
  return arr.sort((a, b) => {
    const d = prio(b) - prio(a);
    if (d) return d;
    const la = String((a && (a.label || a.id)) || '');
    const lb = String((b && (b.label || b.id)) || '');
    const c = la.localeCompare(lb);
    if (c) return c;
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  });
}

export function serializeWorkflowsFragment(workflows) {
  const body = (workflows || []).map(serializeWorkflow).join('\n\n');
  return `<workflows>\n${body}\n</workflows>`;
}

export { escXml, decode };
