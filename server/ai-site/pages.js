import { t } from '../i18n.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#e8ecf1;color:#26303c}
header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #ccd4de;background:#dfe5ec}
header h1{font-size:16px;margin:0;flex:1}
a{color:#2563eb;text-decoration:none}
main{padding:18px;max-width:1000px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #ccd4de;border-radius:10px;background:#f2f5f8;color:#26303c}
.card:hover{border-color:#2563eb}
.logo{width:42px;height:42px;border-radius:8px;object-fit:cover;background:#dde4ec;flex:none;display:flex;align-items:center;justify-content:center;font-size:20px}
.card b{display:block;color:#111827}
.card small{color:#5b6776}
form.card{display:block}
label{display:block;margin:10px 0 4px;color:#4b5866}
input,select,textarea{width:100%;padding:7px 9px;border-radius:6px;border:1px solid #bfc9d6;background:#f7f9fb;color:#1f2937;font:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid #93c5fd;outline-offset:1px}
textarea{min-height:90px;resize:vertical}
button{padding:7px 16px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;font:inherit}
button:disabled{opacity:.5;cursor:default}
pre{background:#e9edf2;border:1px solid #ccd4de;border-radius:8px;padding:10px;white-space:pre-wrap;overflow:auto;max-height:360px;font-size:12px;color:#1f2937}
.out{list-style:none;padding:0;margin:0}
.out li{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #dbe1e8}
.out li span{flex:1;word-break:break-all}
.err{color:#dc2626}
.muted{color:#5b6776}
.runwrap{display:flex;flex-direction:column;height:calc(100vh - 50px);max-width:none;margin:0;padding:12px 16px;box-sizing:border-box;gap:10px}
.runbar{display:flex;align-items:center;gap:8px;font-size:13px;color:#4b5866;flex:none}
.rundot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:none}
.rundot.running{background:#eab308;animation:runpulse 1s ease-in-out infinite}
.rundot.success{background:#22c55e}
.rundot.error,.rundot.timeout{background:#ef4444}
@keyframes runpulse{0%,100%{opacity:1}50%{opacity:.35}}
.term{flex:1;min-height:0;margin:0;padding:14px 16px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#1b2430;color:#cfd9e6;border:1px solid #2b3644;border-radius:10px;font:12.5px/1.55 ui-monospace,Consolas,"Cascadia Mono","Courier New",monospace}
`;

function shell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

export function loginPage({ base = '', error = false }) {
  const action = `${base}/__login`;
  return shell(t('ai_site.login.title'),
    `<header><h1>${esc(t('ai_site.login.title'))}</h1></header>
<main><form class="card" method="POST" action="${esc(action)}">
<label>${esc(t('ai_site.login.token'))}</label><input name="token" type="password" autocomplete="off" />
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
  const LABELS = {
    running: t('ai_site.run.status.running'),
    success: t('ai_site.run.status.success'),
    error: t('ai_site.run.status.error'),
    timeout: t('ai_site.run.status.timeout'),
  };
  const script = `
const base = ${JSON.stringify(base)};
const form = document.getElementById('f');
const statusEl = document.getElementById('status');
const outEl = document.getElementById('out');
const runLink = document.getElementById('runlink');
const ziplink = document.getElementById('ziplink');
const LABELS = ${JSON.stringify(LABELS)};
const EMPTY = ${JSON.stringify(t('ai_site.result.empty'))};
const DOWNLOAD = ${JSON.stringify(t('ai_site.result.download'))};
let runId = '';
const btn = form.querySelector('button[type=submit]');
function setStatus(s){ statusEl.textContent = LABELS[s] || s || ''; }
function renderFiles(files){
  ziplink.style.display = '';
  ziplink.href = base + '/__api/runs/' + encodeURIComponent(runId) + '/zip';
  outEl.innerHTML = '';
  if(!files.length){ outEl.innerHTML = '<li class="muted">' + EMPTY + '</li>'; return; }
  for(const f of files){
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = base + '/__api/runs/' + encodeURIComponent(runId) + '/file?path=' + encodeURIComponent(f.path);
    a.textContent = f.path + ' (' + f.size + 'B)';
    a.target = '_blank';
    const dl = document.createElement('a');
    dl.href = a.href + '&download=1';
    dl.textContent = DOWNLOAD;
    li.appendChild(a); li.appendChild(dl);
    outEl.appendChild(li);
  }
}
async function loadFiles(){
  try {
    const r = await fetch(base + '/__api/runs/' + encodeURIComponent(runId) + '/files');
    const j = await r.json();
    renderFiles(j.items || []);
  } catch (e) { /* ignore */ }
}
async function poll(){
  if(!runId) return;
  try {
    const r = await fetch(base + '/__api/runs/' + encodeURIComponent(runId));
    if(r.ok){
      const m = await r.json();
      setStatus(m.status);
      if(m.status !== 'running'){
        btn.disabled = false;
        await loadFiles();
        return;
      }
    }
  } catch (e) { /* ignore */ }
  setTimeout(poll, 800);
}
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.checked) values[el.name] = '1'; }
    else values[el.name] = el.value;
  }
  const runTab = window.open('', '_blank');
  btn.disabled = true; setStatus('running'); outEl.innerHTML = ''; ziplink.style.display = 'none';
  try {
    const res = await fetch(base + '/__api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plugin: ${JSON.stringify(plugin.name)}, values }) });
    const j = await res.json();
    if (!res.ok || !j.runId) throw new Error(j.error || ('HTTP ' + res.status));
    runId = j.runId;
    const url = base + '/__run/' + encodeURIComponent(runId);
    runLink.href = url; runLink.style.display = '';
    if (runTab) runTab.location.href = new URL(url, location.href).href;
    else { location.href = url; return; }
    poll();
  } catch (e) {
    if (runTab) { try { runTab.close(); } catch (err) { /* ignore */ } }
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
<p><button type="submit">${esc(t('ai_site.form.run'))}</button> <span id="status" class="muted"></span> <a id="runlink" href="#" target="_blank" style="display:none">${esc(t('ai_site.run.reopen'))}</a></p>
</form>
<h3>${esc(t('ai_site.result.output'))} <a href="#" id="ziplink" style="display:none">${esc(t('ai_site.result.zip'))}</a></h3>
<ul class="out" id="out"><li class="muted">${esc(t('ai_site.result.empty'))}</li></ul>
</main><script>${script}</script>`);
}

export function runPage({ base = '', runId = '' }) {
  const LABELS = {
    running: t('ai_site.run.status.running'),
    success: t('ai_site.run.status.success'),
    error: t('ai_site.run.status.error'),
    timeout: t('ai_site.run.status.timeout'),
  };
  const script = `
const base = ${JSON.stringify(base)};
const id = ${JSON.stringify(String(runId))};
const LABELS = ${JSON.stringify(LABELS)};
const term = document.getElementById('term');
const statusEl = document.getElementById('rstatus');
const dot = document.getElementById('dot');
const pluginEl = document.getElementById('rplugin');
const ANSI = new RegExp(String.fromCharCode(27) + '\\\\[[0-9;?]*[ -/]*[@-~]', 'g');
function clean(s){
  return String(s || '').replace(ANSI, '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
}
function paint(text){
  if(term.textContent === text) return;
  term.textContent = text;
  term.scrollTop = term.scrollHeight;
}
async function tick(){
  try {
    const r = await fetch(base + '/__api/runs/' + encodeURIComponent(id));
    if(r.ok){
      const m = await r.json();
      paint(clean(m.log || ''));
      statusEl.textContent = LABELS[m.status] || m.status || '';
      dot.className = 'rundot ' + (m.status || '');
      if(m.plugin) pluginEl.textContent = m.plugin;
      if(m.status !== 'running') return;
    }
  } catch (e) { /* ignore */ }
  setTimeout(tick, 700);
}
tick();
`;
  return shell(t('ai_site.run.title'),
    `<header><h1>${esc(t('ai_site.run.title'))}</h1><a href="${esc(base || '/')}">${esc(t('ai_site.title'))}</a></header>
<main class="runwrap">
<div class="runbar"><span id="dot" class="rundot running"></span><span id="rstatus">${esc(t('ai_site.run.status.running'))}</span><span class="muted" id="rplugin"></span></div>
<pre id="term" class="term"></pre>
</main><script>${script}</script>`);
}
