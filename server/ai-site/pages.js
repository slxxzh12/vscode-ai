import { t } from '../i18n.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#0e1116;color:#d5dae1}
header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #2a323e;background:#11151b}
header h1{font-size:16px;margin:0;flex:1}
a{color:#4c9aff;text-decoration:none}
main{padding:18px;max-width:1000px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #2a323e;border-radius:10px;background:#151b23;color:#d5dae1}
.card:hover{border-color:#4c9aff}
.logo{width:42px;height:42px;border-radius:8px;object-fit:cover;background:#222b36;flex:none;display:flex;align-items:center;justify-content:center;font-size:20px}
.card b{display:block;color:#e6e9ef}
.card small{color:#8b97a7}
form.card{display:block}
label{display:block;margin:10px 0 4px;color:#9aa4b2}
input,select,textarea{width:100%;padding:7px 9px;border-radius:6px;border:1px solid #2a323e;background:#0e1116;color:#e6e9ef;font:inherit}
textarea{min-height:90px;resize:vertical}
button{padding:7px 16px;border-radius:6px;border:1px solid #4c9aff;background:#4c9aff;color:#fff;cursor:pointer;font:inherit}
button:disabled{opacity:.5;cursor:default}
pre{background:#0a0d11;border:1px solid #2a323e;border-radius:8px;padding:10px;white-space:pre-wrap;overflow:auto;max-height:360px;font-size:12px}
.out{list-style:none;padding:0;margin:0}
.out li{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #1c232c}
.out li span{flex:1;word-break:break-all}
.err{color:#ff6b6b}
.muted{color:#8b97a7}
`;

function shell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

export function loginPage({ base = '', error = false }) {
  const action = `${base}/__login`;
  return shell(t('ai_site.login.title'),
    `<header><h1>${esc(t('ai_site.login.title'))}</h1></header>
<main><form class="card" method="POST" action="${esc(action)}">
<label>${esc(t('ai_site.login.username'))}</label><input name="username" autocomplete="username" />
<label>${esc(t('ai_site.login.token'))}</label><input name="token" type="password" autocomplete="current-password" />
${error ? `<p class="err">${esc(t('ai_site.login.error'))}</p>` : ''}
<p><button type="submit">${esc(t('ai_site.login.submit'))}</button></p>
</form></main>`);
}

export function listPage({ base = '', plugins = [], authenticated = false }) {
  const cards = plugins.map((p) => `<a class="card" href="${esc(`${base}/p/${encodeURIComponent(p.name)}`)}">
<span class="logo">${p.hasLogo ? `<img class="logo" src="${esc(`${base}/__assets/logo/${encodeURIComponent(p.name)}`)}" alt="" />` : '🧩'}</span>
<span><b>${esc(p.title)}</b><small>${esc(p.description || '')}${p.error ? ` · ${esc(t('ai_site.plugins.bad'))}` : ''}</small></span>
</a>`).join('');
  return shell(t('ai_site.title'),
    `<header><h1>${esc(t('ai_site.title'))}</h1>${authenticated ? `<a href="${esc(`${base}/__logout`)}">${esc(t('ai_site.logout'))}</a>` : ''}</header>
<main>${plugins.length ? `<div class="grid">${cards}</div>` : `<p class="muted">${esc(t('ai_site.plugins.empty'))}</p>`}</main>`);
}

function fieldHtml(f) {
  const label = `<label>${esc(f.label)}${f.required ? ' *' : ''}</label>`;
  if (f.type === 'textarea') {
    return `${label}<textarea name="${esc(f.key)}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.default || '')}</textarea>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o)}"${String(f.default) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `${label}<select name="${esc(f.key)}"${f.required ? ' required' : ''}>${opts}</select>`;
  }
  if (f.type === 'checkbox') {
    return `<label><input type="checkbox" name="${esc(f.key)}" value="1"${f.default === 'true' ? ' checked' : ''} /> ${esc(f.label)}</label>`;
  }
  const attrs = [
    `type="${esc(f.type)}"`, `name="${esc(f.key)}"`,
    f.required ? 'required' : '',
    f.placeholder !== undefined ? `placeholder="${esc(f.placeholder)}"` : '',
    f.default !== undefined ? `value="${esc(f.default)}"` : '',
    f.min !== undefined ? `min="${esc(f.min)}"` : '',
    f.max !== undefined ? `max="${esc(f.max)}"` : '',
    f.step !== undefined ? `step="${esc(f.step)}"` : '',
  ].filter(Boolean).join(' ');
  return `${label}<input ${attrs} />`;
}

export function formPage({ base = '', plugin }) {
  const fields = (plugin.fields || []).map(fieldHtml).join('');
  const hasFile = (plugin.fields || []).some((f) => f.type === 'file');
  const script = `
const base = ${JSON.stringify(base)};
const form = document.getElementById('f');
const log = document.getElementById('log');
const statusEl = document.getElementById('status');
const outEl = document.getElementById('out');
window.__runId = '';
function renderFiles(files){
  document.getElementById('ziplink').href = base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/zip';
  outEl.innerHTML = '';
  document.getElementById('outwrap').style.display = 'block';
  if(!files.length){ outEl.innerHTML = '<li class="muted">${esc(t('ai_site.result.empty'))}</li>'; return; }
  for(const f of files){
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/file?path=' + encodeURIComponent(f.path);
    a.textContent = f.path + ' (' + f.size + 'B)';
    a.target = '_blank';
    const dl = document.createElement('a');
    dl.href = a.href + '&download=1';
    dl.textContent = '${esc(t('ai_site.result.download'))}';
    li.appendChild(a); li.appendChild(dl);
    outEl.appendChild(li);
  }
}
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.checked) values[el.name] = '1'; }
    else values[el.name] = el.value;
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; statusEl.textContent = '${esc(t('ai_site.form.running'))}'; log.textContent = ''; outEl.innerHTML = '';
  try {
    const res = await fetch(base + '/__api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin: ${JSON.stringify(plugin.name)}, values }) });
    const j = await res.json();
    if (!res.ok || !j.runId) throw new Error(j.error || ('HTTP ' + res.status));
    window.__runId = j.runId;
    const es = new EventSource(base + '/__api/stream/' + encodeURIComponent(j.runId));
    es.addEventListener('chunk', (e) => { log.textContent += JSON.parse(e.data).data; log.scrollTop = log.scrollHeight; });
    es.addEventListener('done', async (e) => {
      const d = JSON.parse(e.data);
      statusEl.textContent = d.status;
      es.close(); btn.disabled = false;
      try { const r = await fetch(base + '/__api/runs/' + encodeURIComponent(window.__runId) + '/files'); const fj = await r.json(); renderFiles(fj.items || []); } catch (err) {}
    });
    es.onerror = () => { es.close(); btn.disabled = false; statusEl.textContent = 'error'; };
  } catch (e) {
    statusEl.textContent = String(e && e.message || e);
    btn.disabled = false;
  }
});
`;
  return shell(`${plugin.title} · ${t('ai_site.title')}`,
    `<header><h1>${esc(plugin.title)}</h1><a href="${esc(base || '/')}">${esc(t('ai_site.title'))}</a></header>
<main>
<p class="muted">${esc(plugin.description || '')}</p>
<form id="f" class="card">${fields}
${hasFile ? `<p class="muted">${esc(t('ai_site.form.file_unsupported'))}</p>` : ''}
<p><button type="submit">${esc(t('ai_site.form.run'))}</button> <span id="status" class="muted"></span></p>
</form>
<h3>${esc(t('ai_site.result.log'))}</h3><pre id="log"></pre>
<div id="outwrap" style="display:none">
<h3>${esc(t('ai_site.result.output'))} <a href="#" id="ziplink">${esc(t('ai_site.result.zip'))}</a></h3>
<ul class="out" id="out"></ul>
</div>
</main><script>${script}</script>`);
}
