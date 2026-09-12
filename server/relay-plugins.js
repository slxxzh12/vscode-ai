import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeExport(mod) {
  const def = mod && mod.default !== undefined ? mod.default : mod;
  const list = Array.isArray(def) ? def : [def];
  return list.filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name);
}

export async function loadPlugins(dir) {
  const plugins = [];
  const entries = [];
  if (!dir || !fs.existsSync(dir)) return { plugins, entries };
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return { plugins, entries };
  }
  const stamp = Date.now();
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const mod = await import(`${pathToFileURL(full).href}?v=${stamp}`);
      const list = normalizeExport(mod);
      if (!list.length) {
        entries.push({ file, name: '', priority: 100, error: 'no-plugin-export' });
        continue;
      }
      for (const p of list) {
        const priority = Number.isFinite(p.priority) ? p.priority : 100;
        plugins.push({ ...p, priority, file });
        entries.push({ file, name: p.name, priority, error: null });
      }
    } catch (e) {
      entries.push({ file, name: '', priority: 100, error: String((e && e.message) || e) });
    }
  }
  plugins.sort((a, b) => a.priority - b.priority);
  return { plugins, entries };
}

function applies(plugin, ctx) {
  if (typeof plugin.match !== 'function') return true;
  try { return !!plugin.match(ctx); } catch { return false; }
}

async function runHook(hook, plugin, ctx, logger) {
  if (!applies(plugin, ctx) || typeof plugin[hook] !== 'function') return;
  try {
    const out = await plugin[hook](ctx);
    if (out && typeof out === 'object') Object.assign(ctx, out);
  } catch (e) {
    logger?.warn?.(`relay plugin ${plugin.name} ${hook} failed: ${(e && e.message) || e}`);
    if (!plugin.failOpen) {
      const err = new Error('plugin-error');
      err.pluginError = true;
      throw err;
    }
  }
}

export async function runRequestPlugins(plugins, ctx, logger = console) {
  for (const p of plugins) await runHook('onRequest', p, ctx, logger);
  return ctx;
}

export async function runResponsePlugins(plugins, ctx, logger = console) {
  for (const p of plugins) await runHook('onResponse', p, ctx, logger);
  return ctx;
}

export function pluginCacheKeyOverride(plugins, ctx, logger = console) {
  for (const p of plugins) {
    if (typeof p.onCacheKey !== 'function' || !applies(p, ctx)) continue;
    try {
      const out = p.onCacheKey(ctx);
      if (out === null) return null;
      if (out && typeof out === 'object') return out;
    } catch (e) {
      logger?.warn?.(`relay plugin ${p.name} onCacheKey failed: ${(e && e.message) || e}`);
      if (!p.failOpen) {
        const err = new Error('plugin-error');
        err.pluginError = true;
        throw err;
      }
    }
  }
  return undefined;
}

export function seedPlugins(destDir, templateDir) {
  if (!destDir || !templateDir || !fs.existsSync(templateDir)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(templateDir).sort()) {
    const src = path.join(templateDir, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(destDir, name);
    if (fs.existsSync(dst)) continue;
    fs.copyFileSync(src, dst);
    copied.push(name);
  }
  return copied;
}

export const EXAMPLE_PLUGIN = `// DevFlow relay plugin (starter).
// Copy/edit this file, then click "Reload plugins" in the Relay panel.
export default {
  name: 'my-plugin',
  priority: 100,
  onRequest(ctx) {
    // Example: add a header on the way upstream.
    ctx.headers['x-relay-by'] = 'devflow';
  },
  // onCacheKey(ctx) {
  //   // return null to bypass cache, or { ttlMs: 60000 } to override TTL.
  //   return { ttlMs: 60000 };
  // },
  // onResponse(ctx) {
  //   // Runs for non-streaming responses only.
  // },
};
`;

export function writeExamplePlugin(dir, content = EXAMPLE_PLUGIN) {
  fs.mkdirSync(dir, { recursive: true });
  let name = 'my-plugin.mjs';
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) { name = `my-plugin-${i}.mjs`; i += 1; }
  fs.writeFileSync(path.join(dir, name), content);
  return name;
}
